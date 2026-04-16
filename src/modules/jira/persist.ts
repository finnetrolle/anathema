import {
  Prisma,
  TimelineMarkerKind as PrismaTimelineMarkerKind,
  SyncStatus,
} from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import {
  resolveJiraRuntimeConfig,
  searchJiraIssuesPage,
} from "@/modules/jira/client";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";
import {
  deriveAssigneeColor,
  deriveAssigneeIdentity,
  deriveTimelineFields,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";
import {
  resolveWorkflowRules,
  type JiraWorkflowRules,
} from "@/modules/jira/workflow-rules";
import type { TimelineMarkerKind } from "@/modules/timeline/types";

const DEFAULT_JIRA_SYNC_PAGE_SIZE = 25;

type RunJiraSyncInput = {
  jql?: string;
  maxResults?: number;
  signal?: AbortSignal;
};

type RunJiraSyncChunkInput = RunJiraSyncInput & {
  syncRunId?: string;
  startAt?: number;
};

type SyncCounts = {
  projectsSynced: number;
  epicsSynced: number;
  assigneesSynced: number;
  issuesSynced: number;
  statusTransitionsSynced: number;
};

type SyncSummaryFragment = {
  projectKeys: string[];
  epicKeys: string[];
  assigneeIds: string[];
};

type PersistIssuesResult = SyncCounts & SyncSummaryFragment;

type RunJiraSyncChunkResult = SyncCounts & {
  ok: true;
  syncRunId: string;
  jiraConnectionId: string;
  requestedJql: string;
  issuesFetched: number;
  pageIssuesFetched: number;
  summaryFragment: SyncSummaryFragment;
  page: {
    startAt: number;
    total: number;
    pageSize: number;
    nextStartAt: number | null;
    hasMore: boolean;
  };
};

type ProjectSeed = {
  jiraProjectId: string;
  key: string;
  name: string;
};

type EpicSeed = {
  jiraEpicId: string;
  key: string;
  summary: string;
  status: string;
  jiraUpdatedAt: Date | null;
};

type PersistedEpicRecord = {
  id: string;
  syncRunId: string;
  stagedProjectId: string;
  jiraEpicId: string;
  key: string;
  summary: string;
  status: string;
  jiraUpdatedAt: Date | null;
};

function readEpicLinkKey(issue: JiraIssue, epicLinkFieldId?: string) {
  if (!epicLinkFieldId) {
    return null;
  }

  const value = issue.fields[epicLinkFieldId];

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "key" in value && typeof value.key === "string") {
    return value.key;
  }

  return null;
}

function parseJiraDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00.000Z`
    : value;
  const parsed = new Date(normalizedValue);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toPrismaJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullablePrismaJson(value: Prisma.JsonValue | null) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function buildRawPayload(
  issue: JiraIssue,
  storyPointFieldIds?: string[],
  developmentFieldIds?: string[],
) {
  return {
    ...issue,
    __anathemaMeta: {
      storyPointFieldIds: storyPointFieldIds ?? [],
      developmentFieldIds: developmentFieldIds ?? [],
    },
  };
}

function toPrismaMarkerKind(kind: TimelineMarkerKind) {
  switch (kind) {
    case "DONE":
      return PrismaTimelineMarkerKind.DONE;
    case "DUE":
      return PrismaTimelineMarkerKind.DUE;
    default:
      return PrismaTimelineMarkerKind.NONE;
  }
}

function isEpicIssue(issue: JiraIssue) {
  return issue.fields.issuetype?.name?.toLowerCase() === "epic";
}

function buildProjectSeed(issue: JiraIssue): ProjectSeed {
  const inferredKey = issue.key.split("-")[0] ?? "UNKNOWN";

  return {
    jiraProjectId: issue.fields.project?.id ?? inferredKey,
    key: issue.fields.project?.key ?? inferredKey,
    name: issue.fields.project?.name ?? inferredKey,
  };
}

function buildEpicSeed(issue: JiraIssue): EpicSeed | null {
  if (isEpicIssue(issue)) {
    return {
      jiraEpicId: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name ?? "Unknown",
      jiraUpdatedAt: parseJiraDate(issue.fields.updated),
    };
  }

  if (!issue.fields.parent) {
    return null;
  }

  return {
    jiraEpicId: issue.fields.parent.id,
    key: issue.fields.parent.key,
    summary: issue.fields.parent.fields?.summary ?? issue.fields.parent.key,
    status: "Unknown",
    jiraUpdatedAt: null,
  };
}

function buildEpicLookup(issues: JiraIssue[]) {
  const epicLookup = new Map<string, JiraIssue>();

  for (const issue of issues) {
    if (isEpicIssue(issue)) {
      epicLookup.set(issue.id, issue);
      epicLookup.set(issue.key, issue);
    }
  }

  return epicLookup;
}

function buildLinkedEpicSeed(params: {
  issue: JiraIssue;
  epicLookup: Map<string, JiraIssue>;
  epicLinkFieldId?: string;
}): EpicSeed | null {
  const epicKey = readEpicLinkKey(params.issue, params.epicLinkFieldId);

  if (!epicKey) {
    return null;
  }

  const epicIssue = params.epicLookup.get(epicKey);

  if (epicIssue) {
    return {
      jiraEpicId: epicIssue.id,
      key: epicIssue.key,
      summary: epicIssue.fields.summary,
      status: epicIssue.fields.status?.name ?? "Unknown",
      jiraUpdatedAt: parseJiraDate(epicIssue.fields.updated),
    };
  }

  return {
    jiraEpicId: epicKey,
    key: epicKey,
    summary: epicKey,
    status: "Unknown",
    jiraUpdatedAt: null,
  };
}

function buildEpicCacheKey(jiraProjectId: string, identifier: string) {
  return `${jiraProjectId}:${identifier}`;
}

function isPlaceholderEpicId(jiraEpicId: string, key: string) {
  return jiraEpicId === key;
}

function isPlaceholderEpicSummary(summary: string, key: string) {
  const normalizedSummary = summary.trim();

  return normalizedSummary.length === 0 || normalizedSummary === key;
}

function mergeEpicValues(
  existingEpic: PersistedEpicRecord,
  epicSeed: EpicSeed,
) {
  const existingIdIsPlaceholder = isPlaceholderEpicId(
    existingEpic.jiraEpicId,
    existingEpic.key,
  );
  const incomingIdIsPlaceholder = isPlaceholderEpicId(
    epicSeed.jiraEpicId,
    epicSeed.key,
  );

  return {
    jiraEpicId:
      existingIdIsPlaceholder && !incomingIdIsPlaceholder
        ? epicSeed.jiraEpicId
        : existingEpic.jiraEpicId,
    key: epicSeed.key,
    summary: isPlaceholderEpicSummary(epicSeed.summary, epicSeed.key)
      ? existingEpic.summary
      : epicSeed.summary,
    status: epicSeed.status === "Unknown" ? existingEpic.status : epicSeed.status,
    jiraUpdatedAt: epicSeed.jiraUpdatedAt ?? existingEpic.jiraUpdatedAt,
  };
}

async function upsertStagedEpic(params: {
  syncRunId: string;
  stagedProjectId: string;
  epicSeed: EpicSeed;
  epicCache: Map<string, PersistedEpicRecord>;
  signal?: AbortSignal;
}) {
  const cacheKeyById = buildEpicCacheKey(
    params.stagedProjectId,
    params.epicSeed.jiraEpicId,
  );
  const cacheKeyByKey = buildEpicCacheKey(
    params.stagedProjectId,
    params.epicSeed.key,
  );

  const cachedEpic =
    params.epicCache.get(cacheKeyById) ?? params.epicCache.get(cacheKeyByKey);
  const existingEpic =
    cachedEpic ??
    (await runWithAbortCheck(
      () =>
        prisma.stagedEpic.findFirst({
          where: {
            syncRunId: params.syncRunId,
            stagedProjectId: params.stagedProjectId,
            OR: [
              {
                jiraEpicId: params.epicSeed.jiraEpicId,
              },
              {
                key: params.epicSeed.key,
              },
            ],
          },
          select: {
            id: true,
            syncRunId: true,
            stagedProjectId: true,
            jiraEpicId: true,
            key: true,
            summary: true,
            status: true,
            jiraUpdatedAt: true,
          },
        }),
      params.signal,
    ));

  const epic = existingEpic
    ? await runWithAbortCheck(
        () =>
          prisma.stagedEpic.update({
            where: {
              id: existingEpic.id,
            },
            data: mergeEpicValues(existingEpic, params.epicSeed),
          }),
        params.signal,
      )
    : await runWithAbortCheck(
        () =>
          prisma.stagedEpic.create({
            data: {
              syncRunId: params.syncRunId,
              stagedProjectId: params.stagedProjectId,
              jiraEpicId: params.epicSeed.jiraEpicId,
              key: params.epicSeed.key,
              summary: params.epicSeed.summary,
              status: params.epicSeed.status,
              jiraUpdatedAt: params.epicSeed.jiraUpdatedAt,
            },
          }),
        params.signal,
      );

  const persistedEpic: PersistedEpicRecord = {
    id: epic.id,
    syncRunId: epic.syncRunId,
    stagedProjectId: epic.stagedProjectId,
    jiraEpicId: epic.jiraEpicId,
    key: epic.key,
    summary: epic.summary,
    status: epic.status,
    jiraUpdatedAt: epic.jiraUpdatedAt,
  };

  params.epicCache.set(
    buildEpicCacheKey(params.stagedProjectId, persistedEpic.jiraEpicId),
    persistedEpic,
  );
  params.epicCache.set(
    buildEpicCacheKey(params.stagedProjectId, persistedEpic.key),
    persistedEpic,
  );

  return epic;
}

async function runWithAbortCheck<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const result = await task();
  throwIfAborted(signal);

  return result;
}

async function persistIssues(params: {
  syncRunId: string;
  issues: JiraIssue[];
  workflowRules: JiraWorkflowRules;
  epicLinkFieldId?: string;
  storyPointFieldIds?: string[];
  developmentFieldIds?: string[];
  signal?: AbortSignal;
}): Promise<PersistIssuesResult> {
  const projects = new Set<string>();
  const epics = new Set<string>();
  const assignees = new Set<string>();
  const syncedIssues = new Set<string>();
  const transitions = new Set<string>();
  const epicLookup = buildEpicLookup(params.issues);
  const epicCache = new Map<string, PersistedEpicRecord>();

  for (const issue of params.issues) {
    throwIfAborted(params.signal);
    const projectSeed = buildProjectSeed(issue);
    const stagedProject = await runWithAbortCheck(
      () =>
        prisma.stagedJiraProject.upsert({
          where: {
            syncRunId_jiraProjectId: {
              syncRunId: params.syncRunId,
              jiraProjectId: projectSeed.jiraProjectId,
            },
          },
          update: {
            key: projectSeed.key,
            name: projectSeed.name,
          },
          create: {
            syncRunId: params.syncRunId,
            jiraProjectId: projectSeed.jiraProjectId,
            key: projectSeed.key,
            name: projectSeed.name,
          },
        }),
      params.signal,
    );
    projects.add(stagedProject.key);

    const assigneeDetails = issue.fields.assignee;
    const assigneeIdentity = deriveAssigneeIdentity(assigneeDetails);
    const stagedAssignee = assigneeDetails
      && assigneeIdentity
      ? await runWithAbortCheck(
          () =>
            prisma.stagedAssignee.upsert({
              where: {
                syncRunId_jiraAccountId: {
                  syncRunId: params.syncRunId,
                  jiraAccountId: assigneeIdentity,
                },
              },
              update: {
                displayName: assigneeDetails.displayName,
                email: assigneeDetails.emailAddress ?? null,
                color: deriveAssigneeColor(assigneeIdentity),
              },
              create: {
                syncRunId: params.syncRunId,
                jiraAccountId: assigneeIdentity,
                displayName: assigneeDetails.displayName,
                email: assigneeDetails.emailAddress ?? null,
                color: deriveAssigneeColor(assigneeIdentity),
              },
            }),
          params.signal,
        )
      : null;

    if (stagedAssignee) {
      assignees.add(stagedAssignee.jiraAccountId);
    }

    const epicSeed =
      buildEpicSeed(issue) ??
      buildLinkedEpicSeed({
        issue,
        epicLookup,
        epicLinkFieldId: params.epicLinkFieldId,
      });
    const stagedEpic = epicSeed
      ? await upsertStagedEpic({
          syncRunId: params.syncRunId,
          stagedProjectId: stagedProject.id,
          epicSeed,
          epicCache,
          signal: params.signal,
        })
      : null;

    if (stagedEpic) {
      epics.add(stagedEpic.key);
    }

    const timelineFields = deriveTimelineFields(issue, params.workflowRules);
    const persistedIssue = await runWithAbortCheck(
      () =>
        prisma.stagedIssue.upsert({
          where: {
            syncRunId_stagedProjectId_jiraIssueId: {
              syncRunId: params.syncRunId,
              stagedProjectId: stagedProject.id,
              jiraIssueId: issue.id,
            },
          },
          update: {
            stagedEpicId: isEpicIssue(issue) ? null : (stagedEpic?.id ?? null),
            stagedAssigneeId: stagedAssignee?.id ?? null,
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name ?? "Unknown",
            issueType: issue.fields.issuetype?.name ?? "Unknown",
            priority: issue.fields.priority?.name ?? null,
            dueAt: parseJiraDate(issue.fields.duedate),
            resolvedAt: parseJiraDate(issue.fields.resolutiondate),
            startedAt: parseJiraDate(timelineFields.startAt),
            markerAt: parseJiraDate(timelineFields.markerAt),
            markerKind: toPrismaMarkerKind(timelineFields.markerKind),
            jiraCreatedAt: parseJiraDate(issue.fields.created),
            jiraUpdatedAt: parseJiraDate(issue.fields.updated),
            rawPayload: toPrismaJson(
              buildRawPayload(
                issue,
                params.storyPointFieldIds,
                params.developmentFieldIds,
              ),
            ),
          },
          create: {
            syncRunId: params.syncRunId,
            stagedProjectId: stagedProject.id,
            stagedEpicId: isEpicIssue(issue) ? null : (stagedEpic?.id ?? null),
            stagedAssigneeId: stagedAssignee?.id ?? null,
            jiraIssueId: issue.id,
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name ?? "Unknown",
            issueType: issue.fields.issuetype?.name ?? "Unknown",
            priority: issue.fields.priority?.name ?? null,
            dueAt: parseJiraDate(issue.fields.duedate),
            resolvedAt: parseJiraDate(issue.fields.resolutiondate),
            startedAt: parseJiraDate(timelineFields.startAt),
            markerAt: parseJiraDate(timelineFields.markerAt),
            markerKind: toPrismaMarkerKind(timelineFields.markerKind),
            jiraCreatedAt: parseJiraDate(issue.fields.created),
            jiraUpdatedAt: parseJiraDate(issue.fields.updated),
            rawPayload: toPrismaJson(
              buildRawPayload(
                issue,
                params.storyPointFieldIds,
                params.developmentFieldIds,
              ),
            ),
          },
        }),
      params.signal,
    );
    syncedIssues.add(persistedIssue.key);

    const statusTransitions = (issue.changelog?.histories ?? []).flatMap((history) =>
      history.items
        .filter(
          (item): item is typeof item & { toString: string } =>
            item.field === "status" && typeof item.toString === "string",
        )
        .map((item) => ({
          changedAt: parseJiraDate(history.created),
          fromStatus: item.fromString ?? null,
          toStatus: item.toString,
        })),
    );

    for (const transition of statusTransitions) {
      throwIfAborted(params.signal);

      const changedAt = transition.changedAt;

      if (!changedAt) {
        continue;
      }

      await runWithAbortCheck(
        () =>
          prisma.stagedIssueStatusHistory.upsert({
            where: {
              syncRunId_stagedIssueId_changedAt_toStatus: {
                syncRunId: params.syncRunId,
                stagedIssueId: persistedIssue.id,
                changedAt,
                toStatus: transition.toStatus,
              },
            },
            update: {
              fromStatus: transition.fromStatus,
            },
            create: {
              syncRunId: params.syncRunId,
              stagedIssueId: persistedIssue.id,
              fromStatus: transition.fromStatus,
              toStatus: transition.toStatus,
              changedAt,
            },
          }),
        params.signal,
      );

      transitions.add(
        `${persistedIssue.id}:${changedAt.toISOString()}:${transition.toStatus}`,
      );
    }
  }

  return {
    projectsSynced: projects.size,
    epicsSynced: epics.size,
    assigneesSynced: assignees.size,
    issuesSynced: syncedIssues.size,
    statusTransitionsSynced: transitions.size,
    projectKeys: [...projects],
    epicKeys: [...epics],
    assigneeIds: [...assignees],
  };
}

async function upsertJiraConnection(params: {
  runtime: Awaited<ReturnType<typeof resolveJiraRuntimeConfig>>;
  signal?: AbortSignal;
}) {
  throwIfAborted(params.signal);

  return prisma.jiraConnection.upsert({
    where: {
      baseUrl: params.runtime.baseUrl,
    },
    update: {
      name: params.runtime.connectionName,
      defaultJql: params.runtime.defaultJql,
      timezone: params.runtime.timezone,
    },
    create: {
      name: params.runtime.connectionName,
      baseUrl: params.runtime.baseUrl,
      defaultJql: params.runtime.defaultJql,
      timezone: params.runtime.timezone,
    },
  });
}

async function cleanupStagedSyncRun(
  tx: Prisma.TransactionClient,
  syncRunId: string,
) {
  await tx.stagedJiraProject.deleteMany({
    where: {
      syncRunId,
    },
  });
  await tx.stagedAssignee.deleteMany({
    where: {
      syncRunId,
    },
  });
}

async function acquireJiraConnectionLock(
  tx: Prisma.TransactionClient,
  jiraConnectionId: string,
) {
  await tx.$queryRaw<{ advisoryLock: string }[]>`
    SELECT pg_advisory_xact_lock(hashtext(${jiraConnectionId}))::text AS "advisoryLock"
  `;
}

async function publishSyncRun(params: {
  syncRunId: string;
  jiraConnectionId: string;
  signal?: AbortSignal;
}) {
  throwIfAborted(params.signal);

  await prisma.$transaction(async (tx) => {
    await acquireJiraConnectionLock(tx, params.jiraConnectionId);

    const syncRun = await tx.syncRun.findUnique({
      where: {
        id: params.syncRunId,
      },
      select: {
        id: true,
        jiraConnectionId: true,
        startedAt: true,
        status: true,
      },
    });

    if (!syncRun) {
      throw new Error("Sync run not found.");
    }

    if (syncRun.status !== SyncStatus.STARTED) {
      throw new Error("Sync run is no longer active.");
    }

    if (syncRun.jiraConnectionId !== params.jiraConnectionId) {
      throw new Error("Sync run belongs to a different Jira connection.");
    }

    const newerRun = await tx.syncRun.findFirst({
      where: {
        jiraConnectionId: params.jiraConnectionId,
        id: {
          not: params.syncRunId,
        },
        startedAt: {
          gt: syncRun.startedAt,
        },
        status: {
          in: [SyncStatus.STARTED, SyncStatus.SUCCEEDED],
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        startedAt: "desc",
      },
    });

    if (newerRun) {
      throw new Error("A newer sync run already exists for this Jira connection.");
    }

    const stagedProjects = await tx.stagedJiraProject.findMany({
      where: {
        syncRunId: params.syncRunId,
      },
      orderBy: {
        key: "asc",
      },
    });
    const stagedAssignees = await tx.stagedAssignee.findMany({
      where: {
        syncRunId: params.syncRunId,
      },
      orderBy: {
        jiraAccountId: "asc",
      },
    });
    const stagedEpics = await tx.stagedEpic.findMany({
      where: {
        syncRunId: params.syncRunId,
      },
      orderBy: [
        {
          stagedProjectId: "asc",
        },
        {
          key: "asc",
        },
      ],
    });
    const stagedIssues = await tx.stagedIssue.findMany({
      where: {
        syncRunId: params.syncRunId,
      },
      orderBy: [
        {
          stagedProjectId: "asc",
        },
        {
          key: "asc",
        },
      ],
    });
    const stagedIssueHistory = await tx.stagedIssueStatusHistory.findMany({
      where: {
        syncRunId: params.syncRunId,
      },
      orderBy: [
        {
          changedAt: "asc",
        },
        {
          toStatus: "asc",
        },
      ],
    });

    const stagedProjectIds = new Set(stagedProjects.map((project) => project.id));
    const stagedAssigneeIds = new Set(stagedAssignees.map((assignee) => assignee.id));
    const stagedEpicIds = new Set(stagedEpics.map((epic) => epic.id));
    const stagedIssueIds = new Set(stagedIssues.map((issue) => issue.id));

    for (const stagedEpic of stagedEpics) {
      if (!stagedProjectIds.has(stagedEpic.stagedProjectId)) {
        throw new Error("Staged epic references a missing staged project.");
      }
    }

    for (const stagedIssue of stagedIssues) {
      if (!stagedProjectIds.has(stagedIssue.stagedProjectId)) {
        throw new Error("Staged issue references a missing staged project.");
      }

      if (stagedIssue.stagedEpicId && !stagedEpicIds.has(stagedIssue.stagedEpicId)) {
        throw new Error("Staged issue references a missing staged epic.");
      }

      if (
        stagedIssue.stagedAssigneeId &&
        !stagedAssigneeIds.has(stagedIssue.stagedAssigneeId)
      ) {
        throw new Error("Staged issue references a missing staged assignee.");
      }
    }

    for (const transition of stagedIssueHistory) {
      if (!stagedIssueIds.has(transition.stagedIssueId)) {
        throw new Error("Staged issue history references a missing staged issue.");
      }
    }

    throwIfAborted(params.signal);

    await tx.jiraProject.deleteMany({
      where: {
        jiraConnectionId: params.jiraConnectionId,
      },
    });
    await tx.assignee.deleteMany({
      where: {
        jiraConnectionId: params.jiraConnectionId,
      },
    });

    const publishedProjectIds = new Map<string, string>();
    for (const stagedProject of stagedProjects) {
      throwIfAborted(params.signal);

      const project = await tx.jiraProject.create({
        data: {
          jiraConnectionId: params.jiraConnectionId,
          jiraProjectId: stagedProject.jiraProjectId,
          key: stagedProject.key,
          name: stagedProject.name,
        },
      });

      publishedProjectIds.set(stagedProject.id, project.id);
    }

    const publishedAssigneeIds = new Map<string, string>();
    for (const stagedAssignee of stagedAssignees) {
      throwIfAborted(params.signal);

      const assignee = await tx.assignee.create({
        data: {
          jiraConnectionId: params.jiraConnectionId,
          jiraAccountId: stagedAssignee.jiraAccountId,
          displayName: stagedAssignee.displayName,
          email: stagedAssignee.email,
          color: stagedAssignee.color,
        },
      });

      publishedAssigneeIds.set(stagedAssignee.id, assignee.id);
    }

    const publishedEpicIds = new Map<string, string>();
    for (const stagedEpic of stagedEpics) {
      throwIfAborted(params.signal);

      const jiraProjectId = publishedProjectIds.get(stagedEpic.stagedProjectId);

      if (!jiraProjectId) {
        throw new Error("Unable to publish an epic without a project.");
      }

      const epic = await tx.epic.create({
        data: {
          jiraProjectId,
          jiraEpicId: stagedEpic.jiraEpicId,
          key: stagedEpic.key,
          summary: stagedEpic.summary,
          status: stagedEpic.status,
          rank: stagedEpic.rank,
          jiraUpdatedAt: stagedEpic.jiraUpdatedAt,
        },
      });

      publishedEpicIds.set(stagedEpic.id, epic.id);
    }

    const publishedIssueIds = new Map<string, string>();
    for (const stagedIssue of stagedIssues) {
      throwIfAborted(params.signal);

      const jiraProjectId = publishedProjectIds.get(stagedIssue.stagedProjectId);

      if (!jiraProjectId) {
        throw new Error("Unable to publish an issue without a project.");
      }

      const epicId = stagedIssue.stagedEpicId
        ? publishedEpicIds.get(stagedIssue.stagedEpicId)
        : null;

      if (stagedIssue.stagedEpicId && !epicId) {
        throw new Error("Unable to publish an issue with a missing epic.");
      }

      const assigneeId = stagedIssue.stagedAssigneeId
        ? publishedAssigneeIds.get(stagedIssue.stagedAssigneeId)
        : null;

      if (stagedIssue.stagedAssigneeId && !assigneeId) {
        throw new Error("Unable to publish an issue with a missing assignee.");
      }

      const issue = await tx.issue.create({
        data: {
          jiraProjectId,
          epicId,
          assigneeId,
          jiraIssueId: stagedIssue.jiraIssueId,
          key: stagedIssue.key,
          summary: stagedIssue.summary,
          status: stagedIssue.status,
          issueType: stagedIssue.issueType,
          priority: stagedIssue.priority,
          dueAt: stagedIssue.dueAt,
          resolvedAt: stagedIssue.resolvedAt,
          startedAt: stagedIssue.startedAt,
          markerAt: stagedIssue.markerAt,
          markerKind: stagedIssue.markerKind,
          jiraCreatedAt: stagedIssue.jiraCreatedAt,
          jiraUpdatedAt: stagedIssue.jiraUpdatedAt,
          rawPayload: toNullablePrismaJson(stagedIssue.rawPayload),
        },
      });

      publishedIssueIds.set(stagedIssue.id, issue.id);
    }

    if (stagedIssueHistory.length > 0) {
      await tx.issueStatusHistory.createMany({
        data: stagedIssueHistory.map((transition) => {
          const issueId = publishedIssueIds.get(transition.stagedIssueId);

          if (!issueId) {
            throw new Error("Unable to publish issue history without an issue.");
          }

          return {
            issueId,
            syncRunId: params.syncRunId,
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            changedAt: transition.changedAt,
          };
        }),
      });
    }

    await cleanupStagedSyncRun(tx, params.syncRunId);
    await tx.assignee.deleteMany({
      where: {
        issues: {
          none: {},
        },
      },
    });
    await tx.syncRun.update({
      where: {
        id: params.syncRunId,
      },
      data: {
        status: SyncStatus.SUCCEEDED,
        finishedAt: new Date(),
        errorMessage: null,
      },
    });
  });
}

async function failSyncRun(syncRunId: string, error: unknown) {
  const message = isAbortError(error)
    ? "Sync was cancelled."
    : error instanceof Error
      ? error.message
      : "Unknown Jira sync error.";

  await prisma.$transaction(async (tx) => {
    const syncRun = await tx.syncRun.findUnique({
      where: {
        id: syncRunId,
      },
      select: {
        status: true,
      },
    });

    if (!syncRun || syncRun.status !== SyncStatus.STARTED) {
      return;
    }

    await cleanupStagedSyncRun(tx, syncRunId);
    await tx.syncRun.update({
      where: {
        id: syncRunId,
      },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });
  });
}

export async function runJiraSyncChunk({
  jql,
  syncRunId,
  startAt = 0,
  maxResults = DEFAULT_JIRA_SYNC_PAGE_SIZE,
  signal,
}: RunJiraSyncChunkInput): Promise<RunJiraSyncChunkResult> {
  if (startAt > 0 && !syncRunId) {
    throw new Error("Chunk continuation requires syncRunId.");
  }

  throwIfAborted(signal);
  const runtime = await resolveJiraRuntimeConfig(signal);
  const requestedJql = jql ?? runtime.defaultJql;

  throwIfAborted(signal);
  const connection = await upsertJiraConnection({
    runtime,
    signal,
  });
  const workflowRules = resolveWorkflowRules(connection.workflowRules, {
    connectionId: connection.id,
    connectionName: connection.name,
  });

  let activeSyncRunId = syncRunId;

  if (activeSyncRunId) {
    const existingSyncRun = await prisma.syncRun.findUnique({
      where: {
        id: activeSyncRunId,
      },
    });

    if (!existingSyncRun) {
      throw new Error("Sync run not found.");
    }

    if (existingSyncRun.status !== SyncStatus.STARTED) {
      throw new Error("Sync run is no longer active.");
    }

    if (existingSyncRun.jiraConnectionId !== connection.id) {
      throw new Error("Sync run belongs to a different Jira connection.");
    }

    if (
      existingSyncRun.requestedJql &&
      existingSyncRun.requestedJql !== requestedJql
    ) {
      throw new Error("Requested JQL does not match the active sync run.");
    }
  } else {
    throwIfAborted(signal);
    const syncRun = await prisma.$transaction(async (tx) => {
      await acquireJiraConnectionLock(tx, connection.id);

      const existingSyncRun = await tx.syncRun.findFirst({
        where: {
          jiraConnectionId: connection.id,
          status: SyncStatus.STARTED,
        },
        select: {
          id: true,
        },
      });

      if (existingSyncRun) {
        throw new Error("Another sync run is already active for this Jira connection.");
      }

      return tx.syncRun.create({
        data: {
          jiraConnectionId: connection.id,
          status: SyncStatus.STARTED,
          startedAt: new Date(),
          requestedJql,
        },
      });
    });

    activeSyncRunId = syncRun.id;
  }

  try {
    const page = await searchJiraIssuesPage({
      jql: requestedJql,
      startAt,
      maxResults,
      runtime,
      signal,
    });
    const counts = await persistIssues({
      syncRunId: activeSyncRunId,
      issues: page.issues,
      workflowRules,
      epicLinkFieldId: runtime.epicLinkFieldId,
      storyPointFieldIds: runtime.storyPointFieldIds,
      developmentFieldIds: runtime.developmentFieldIds,
      signal,
    });
    const nextStartAt = page.startAt + page.issues.length;
    const hasMore = nextStartAt < page.total && page.issues.length > 0;

    await prisma.syncRun.update({
      where: {
        id: activeSyncRunId,
      },
      data: {
        issuesFetched: nextStartAt,
      },
    });

    if (!hasMore) {
      await publishSyncRun({
        syncRunId: activeSyncRunId,
        jiraConnectionId: connection.id,
        signal,
      });
    }

    return {
      ok: true,
      syncRunId: activeSyncRunId,
      jiraConnectionId: connection.id,
      requestedJql,
      issuesFetched: nextStartAt,
      pageIssuesFetched: page.issues.length,
      projectsSynced: counts.projectsSynced,
      epicsSynced: counts.epicsSynced,
      assigneesSynced: counts.assigneesSynced,
      issuesSynced: counts.issuesSynced,
      statusTransitionsSynced: counts.statusTransitionsSynced,
      summaryFragment: {
        projectKeys: counts.projectKeys,
        epicKeys: counts.epicKeys,
        assigneeIds: counts.assigneeIds,
      },
      page: {
        startAt: page.startAt,
        total: page.total,
        pageSize: page.maxResults,
        nextStartAt: hasMore ? nextStartAt : null,
        hasMore,
      },
    };
  } catch (error) {
    await failSyncRun(activeSyncRunId, error);
    throw error;
  }
}

export async function runJiraSync({
  jql,
  maxResults = DEFAULT_JIRA_SYNC_PAGE_SIZE,
  signal,
}: RunJiraSyncInput) {
  const projectKeys = new Set<string>();
  const epicKeys = new Set<string>();
  const assigneeIds = new Set<string>();
  let syncRunId: string | undefined;
  let issuesFetched = 0;
  let issuesSynced = 0;
  let statusTransitionsSynced = 0;

  while (true) {
    const chunk = await runJiraSyncChunk({
      jql,
      syncRunId,
      startAt: issuesFetched,
      maxResults,
      signal,
    });

    syncRunId = chunk.syncRunId;
    issuesFetched = chunk.issuesFetched;
    issuesSynced += chunk.issuesSynced;
    statusTransitionsSynced += chunk.statusTransitionsSynced;

    for (const projectKey of chunk.summaryFragment.projectKeys) {
      projectKeys.add(projectKey);
    }

    for (const epicKey of chunk.summaryFragment.epicKeys) {
      epicKeys.add(epicKey);
    }

    for (const assigneeId of chunk.summaryFragment.assigneeIds) {
      assigneeIds.add(assigneeId);
    }

    if (!chunk.page.hasMore) {
      return {
        ok: true,
        syncRunId: chunk.syncRunId,
        jiraConnectionId: chunk.jiraConnectionId,
        requestedJql: chunk.requestedJql,
        issuesFetched,
        projectsSynced: projectKeys.size,
        epicsSynced: epicKeys.size,
        assigneesSynced: assigneeIds.size,
        issuesSynced,
        statusTransitionsSynced,
      };
    }
  }
}
