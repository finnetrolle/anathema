import {
  TimelineMarkerKind as PrismaTimelineMarkerKind,
  SyncStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import {
  resolveJiraRuntimeConfig,
  searchJiraIssues,
} from "@/modules/jira/client";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";
import {
  deriveAssigneeColor,
  deriveAssigneeIdentity,
  deriveTimelineFields,
  deriveTimelineTask,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";
import type { TimelineMarkerKind } from "@/modules/timeline/types";

type RunJiraSyncInput = {
  jql?: string;
  maxResults?: number;
  signal?: AbortSignal;
};

type SyncCounts = {
  projectsSynced: number;
  epicsSynced: number;
  assigneesSynced: number;
  issuesSynced: number;
  statusTransitionsSynced: number;
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
  jiraConnectionId: string;
  syncRunId: string;
  issues: JiraIssue[];
  epicLinkFieldId?: string;
  storyPointFieldIds?: string[];
  developmentFieldIds?: string[];
  signal?: AbortSignal;
}): Promise<SyncCounts> {
  const projects = new Set<string>();
  const epics = new Set<string>();
  const assignees = new Set<string>();
  const syncedIssues = new Set<string>();
  const transitions = new Set<string>();
  const epicLookup = buildEpicLookup(params.issues);

  for (const issue of params.issues) {
    throwIfAborted(params.signal);
    const projectSeed = buildProjectSeed(issue);
    const project = await runWithAbortCheck(
      () =>
        prisma.jiraProject.upsert({
          where: {
            jiraConnectionId_jiraProjectId: {
              jiraConnectionId: params.jiraConnectionId,
              jiraProjectId: projectSeed.jiraProjectId,
            },
          },
          update: {
            key: projectSeed.key,
            name: projectSeed.name,
          },
          create: {
            jiraConnectionId: params.jiraConnectionId,
            jiraProjectId: projectSeed.jiraProjectId,
            key: projectSeed.key,
            name: projectSeed.name,
          },
        }),
      params.signal,
    );
    projects.add(project.key);

    const assigneeDetails = issue.fields.assignee;
    const assigneeIdentity = deriveAssigneeIdentity(assigneeDetails);
    const assignee = assigneeDetails
      && assigneeIdentity
      ? await runWithAbortCheck(
          () =>
            prisma.assignee.upsert({
              where: {
                jiraAccountId: assigneeIdentity,
              },
              update: {
                displayName: assigneeDetails.displayName,
                email: assigneeDetails.emailAddress ?? null,
                color: deriveAssigneeColor(assigneeIdentity),
              },
              create: {
                jiraAccountId: assigneeIdentity,
                displayName: assigneeDetails.displayName,
                email: assigneeDetails.emailAddress ?? null,
                color: deriveAssigneeColor(assigneeIdentity),
              },
            }),
          params.signal,
        )
      : null;

    if (assignee) {
      assignees.add(assignee.jiraAccountId);
    }

    const epicSeed =
      buildEpicSeed(issue) ??
      buildLinkedEpicSeed({
        issue,
        epicLookup,
        epicLinkFieldId: params.epicLinkFieldId,
      });
    const epic = epicSeed
      ? await runWithAbortCheck(
          () =>
            prisma.epic.upsert({
              where: {
                jiraProjectId_jiraEpicId: {
                  jiraProjectId: project.id,
                  jiraEpicId: epicSeed.jiraEpicId,
                },
              },
              update: {
                key: epicSeed.key,
                summary: epicSeed.summary,
                status: epicSeed.status,
                jiraUpdatedAt: epicSeed.jiraUpdatedAt,
              },
              create: {
                jiraProjectId: project.id,
                jiraEpicId: epicSeed.jiraEpicId,
                key: epicSeed.key,
                summary: epicSeed.summary,
                status: epicSeed.status,
                jiraUpdatedAt: epicSeed.jiraUpdatedAt,
              },
            }),
          params.signal,
        )
      : null;

    if (epic) {
      epics.add(epic.key);
    }

    const timelineFields = deriveTimelineFields(issue);
    const persistedIssue = await runWithAbortCheck(
      () =>
        prisma.issue.upsert({
          where: {
            jiraProjectId_jiraIssueId: {
              jiraProjectId: project.id,
              jiraIssueId: issue.id,
            },
          },
          update: {
            epicId: isEpicIssue(issue) ? null : (epic?.id ?? null),
            assigneeId: assignee?.id ?? null,
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
            jiraProjectId: project.id,
            epicId: isEpicIssue(issue) ? null : (epic?.id ?? null),
            assigneeId: assignee?.id ?? null,
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
          prisma.issueStatusHistory.upsert({
            where: {
              issueId_changedAt_toStatus: {
                issueId: persistedIssue.id,
                changedAt,
                toStatus: transition.toStatus,
              },
            },
            update: {
              fromStatus: transition.fromStatus,
              syncRunId: params.syncRunId,
            },
            create: {
              issueId: persistedIssue.id,
              syncRunId: params.syncRunId,
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
  };
}

export async function runJiraSync({
  jql,
  maxResults = 100,
  signal,
}: RunJiraSyncInput) {
  throwIfAborted(signal);
  const runtime = await resolveJiraRuntimeConfig(signal);
  const requestedJql = jql ?? runtime.defaultJql;

  throwIfAborted(signal);
  const connection = await prisma.jiraConnection.upsert({
    where: {
      baseUrl: runtime.baseUrl,
    },
    update: {
      name: runtime.connectionName,
      defaultJql: runtime.defaultJql,
      timezone: runtime.timezone,
    },
    create: {
      name: runtime.connectionName,
      baseUrl: runtime.baseUrl,
      defaultJql: runtime.defaultJql,
      timezone: runtime.timezone,
    },
  });

  throwIfAborted(signal);
  const syncRun = await prisma.syncRun.create({
    data: {
      jiraConnectionId: connection.id,
      status: SyncStatus.STARTED,
      startedAt: new Date(),
      requestedJql,
    },
  });

  try {
    const { issues } = await searchJiraIssues({
      jql: requestedJql,
      maxResults,
      runtime,
      signal,
    });
    const counts = await persistIssues({
      jiraConnectionId: connection.id,
      syncRunId: syncRun.id,
      issues,
      epicLinkFieldId: runtime.epicLinkFieldId,
      storyPointFieldIds: runtime.storyPointFieldIds,
      developmentFieldIds: runtime.developmentFieldIds,
      signal,
    });

    await prisma.syncRun.update({
      where: {
        id: syncRun.id,
      },
      data: {
        status: SyncStatus.SUCCEEDED,
        finishedAt: new Date(),
        issuesFetched: issues.length,
      },
    });

    return {
      ok: true,
      syncRunId: syncRun.id,
      jiraConnectionId: connection.id,
      requestedJql,
      issuesFetched: issues.length,
      ...counts,
      sample: issues
        .filter((issue) => !isEpicIssue(issue))
        .slice(0, 10)
        .map(deriveTimelineTask),
    };
  } catch (error) {
    const message = isAbortError(error)
      ? "Sync was cancelled."
      : error instanceof Error
        ? error.message
        : "Unknown Jira sync error.";

    await prisma.syncRun.update({
      where: {
        id: syncRun.id,
      },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    throw error;
  }
}
