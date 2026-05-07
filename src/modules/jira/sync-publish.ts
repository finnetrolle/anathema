import { Prisma, SyncStatus } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";
import { rawSqlCreateReturning } from "@/modules/jira/bulk-sql";
type ResolveJiraRuntimeConfigReturn = Awaited<
  ReturnType<typeof import("@/modules/jira/client").resolveJiraRuntimeConfig>
>;

/** Number of completed sync runs to keep per connection (older ones are cleaned up). */
const KEEP_SYNC_RUNS = 5;

type StagedProjectRow = {
  id: string;
  jiraProjectId: string;
  key: string;
  name: string;
};

type StagedAssigneeRow = {
  id: string;
  jiraAccountId: string;
  displayName: string;
  color: string;
};

type StagedEpicRow = {
  id: string;
  stagedProjectId: string;
  jiraEpicId: string;
  key: string;
  summary: string;
  status: string;
  rank: string | null;
  jiraUpdatedAt: Date | null;
};

type StagedIssueRow = {
  id: string;
  stagedProjectId: string;
  stagedEpicId: string | null;
  stagedAssigneeId: string | null;
  jiraIssueId: string;
  key: string;
  summary: string;
  status: string;
  issueType: string;
  priority: string | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  startedAt: Date | null;
  markerAt: Date | null;
  markerKind: Prisma.JsonValue | string;
  jiraCreatedAt: Date | null;
  jiraUpdatedAt: Date | null;
  rawPayload: Prisma.JsonValue | null;
};

type StagedIssueHistoryRow = {
  stagedIssueId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
};

function buildCompositeKey(left: string, right: string) {
  return `${left}::${right}`;
}

function getRequiredMapValue<Value>(
  map: Map<string, Value>,
  key: string,
  errorMessage: string,
) {
  const value = map.get(key);

  if (value === undefined) {
    throw new Error(errorMessage);
  }

  return value;
}

async function publishLiveDataset(params: {
  tx: Prisma.TransactionClient;
  syncRunId: string;
  jiraConnectionId: string;
  stagedProjects: StagedProjectRow[];
  stagedAssignees: StagedAssigneeRow[];
  stagedEpics: StagedEpicRow[];
  stagedIssues: StagedIssueRow[];
  stagedIssueHistory: StagedIssueHistoryRow[];
  signal?: AbortSignal;
}) {
  throwIfAborted(params.signal);

  await params.tx.jiraProject.deleteMany({
    where: {
      jiraConnectionId: params.jiraConnectionId,
    },
  });
  await params.tx.assignee.deleteMany({
    where: {
      jiraConnectionId: params.jiraConnectionId,
    },
  });

  const createdProjects = await rawSqlCreateReturning({
    table: "JiraProject",
    columns: ["jiraConnectionId", "jiraProjectId", "key", "name"],
    rows: params.stagedProjects.map((project) => ({
      jiraConnectionId: params.jiraConnectionId,
      jiraProjectId: project.jiraProjectId,
      key: project.key,
      name: project.name,
    })),
    returningColumns: ["id", "jiraProjectId"],
    tx: params.tx,
    signal: params.signal,
  });

  const projectIdByJiraProjectId = new Map(
    createdProjects.map((project) => [
      String(project.jiraProjectId),
      String(project.id),
    ]),
  );
  const projectIdByStagedId = new Map<string, string>();
  for (const stagedProject of params.stagedProjects) {
    projectIdByStagedId.set(
      stagedProject.id,
      getRequiredMapValue(
        projectIdByJiraProjectId,
        stagedProject.jiraProjectId,
        `Published Jira project is missing for ${stagedProject.jiraProjectId}.`,
      ),
    );
  }

  const createdAssignees = await rawSqlCreateReturning({
    table: "Assignee",
    columns: ["jiraConnectionId", "jiraAccountId", "displayName", "color"],
    rows: params.stagedAssignees.map((assignee) => ({
      jiraConnectionId: params.jiraConnectionId,
      jiraAccountId: assignee.jiraAccountId,
      displayName: assignee.displayName,
      color: assignee.color,
    })),
    returningColumns: ["id", "jiraAccountId"],
    tx: params.tx,
    signal: params.signal,
  });

  const assigneeIdByJiraAccountId = new Map(
    createdAssignees.map((assignee) => [
      String(assignee.jiraAccountId),
      String(assignee.id),
    ]),
  );
  const assigneeIdByStagedId = new Map<string, string>();
  for (const stagedAssignee of params.stagedAssignees) {
    assigneeIdByStagedId.set(
      stagedAssignee.id,
      getRequiredMapValue(
        assigneeIdByJiraAccountId,
        stagedAssignee.jiraAccountId,
        `Published assignee is missing for ${stagedAssignee.jiraAccountId}.`,
      ),
    );
  }

  const createdEpics = await rawSqlCreateReturning({
    table: "Epic",
    columns: [
      "jiraProjectId",
      "jiraEpicId",
      "key",
      "summary",
      "status",
      "rank",
      "jiraUpdatedAt",
    ],
    rows: params.stagedEpics.map((epic) => ({
      jiraProjectId: getRequiredMapValue(
        projectIdByStagedId,
        epic.stagedProjectId,
        `Published Jira project is missing for staged epic ${epic.id}.`,
      ),
      jiraEpicId: epic.jiraEpicId,
      key: epic.key,
      summary: epic.summary,
      status: epic.status,
      rank: epic.rank,
      jiraUpdatedAt: epic.jiraUpdatedAt,
    })),
    returningColumns: ["id", "jiraProjectId", "jiraEpicId"],
    tx: params.tx,
    signal: params.signal,
  });

  const epicIdByCompositeKey = new Map(
    createdEpics.map((epic) => [
      buildCompositeKey(String(epic.jiraProjectId), String(epic.jiraEpicId)),
      String(epic.id),
    ]),
  );
  const epicIdByStagedId = new Map<string, string>();
  for (const stagedEpic of params.stagedEpics) {
    const publishedProjectId = getRequiredMapValue(
      projectIdByStagedId,
      stagedEpic.stagedProjectId,
      `Published Jira project is missing for staged epic ${stagedEpic.id}.`,
    );
    epicIdByStagedId.set(
      stagedEpic.id,
      getRequiredMapValue(
        epicIdByCompositeKey,
        buildCompositeKey(publishedProjectId, stagedEpic.jiraEpicId),
        `Published epic is missing for ${stagedEpic.jiraEpicId}.`,
      ),
    );
  }

  const createdIssues = await rawSqlCreateReturning({
    table: "Issue",
    columns: [
      "jiraProjectId",
      "epicId",
      "assigneeId",
      "jiraIssueId",
      "key",
      "summary",
      "status",
      "issueType",
      "priority",
      "dueAt",
      "resolvedAt",
      "startedAt",
      "markerAt",
      "markerKind",
      "jiraCreatedAt",
      "jiraUpdatedAt",
      "rawPayload",
    ],
    rows: params.stagedIssues.map((issue) => ({
      jiraProjectId: getRequiredMapValue(
        projectIdByStagedId,
        issue.stagedProjectId,
        `Published Jira project is missing for staged issue ${issue.id}.`,
      ),
      epicId: issue.stagedEpicId
        ? getRequiredMapValue(
            epicIdByStagedId,
            issue.stagedEpicId,
            `Published epic is missing for staged issue ${issue.id}.`,
          )
        : null,
      assigneeId: issue.stagedAssigneeId
        ? getRequiredMapValue(
            assigneeIdByStagedId,
            issue.stagedAssigneeId,
            `Published assignee is missing for staged issue ${issue.id}.`,
          )
        : null,
      jiraIssueId: issue.jiraIssueId,
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      issueType: issue.issueType,
      priority: issue.priority,
      dueAt: issue.dueAt,
      resolvedAt: issue.resolvedAt,
      startedAt: issue.startedAt,
      markerAt: issue.markerAt,
      markerKind: issue.markerKind,
      jiraCreatedAt: issue.jiraCreatedAt,
      jiraUpdatedAt: issue.jiraUpdatedAt,
      rawPayload: issue.rawPayload,
    })),
    returningColumns: ["id", "jiraProjectId", "jiraIssueId"],
    tx: params.tx,
    signal: params.signal,
    typeCasts: {
      markerKind: '"TimelineMarkerKind"',
      rawPayload: "jsonb",
    },
  });

  const issueIdByCompositeKey = new Map(
    createdIssues.map((issue) => [
      buildCompositeKey(String(issue.jiraProjectId), String(issue.jiraIssueId)),
      String(issue.id),
    ]),
  );
  const issueIdByStagedId = new Map<string, string>();
  for (const stagedIssue of params.stagedIssues) {
    const publishedProjectId = getRequiredMapValue(
      projectIdByStagedId,
      stagedIssue.stagedProjectId,
      `Published Jira project is missing for staged issue ${stagedIssue.id}.`,
    );
    issueIdByStagedId.set(
      stagedIssue.id,
      getRequiredMapValue(
        issueIdByCompositeKey,
        buildCompositeKey(publishedProjectId, stagedIssue.jiraIssueId),
        `Published issue is missing for ${stagedIssue.jiraIssueId}.`,
      ),
    );
  }

  await rawSqlCreateReturning({
    table: "IssueStatusHistory",
    columns: ["issueId", "syncRunId", "fromStatus", "toStatus", "changedAt"],
    rows: params.stagedIssueHistory.map((transition) => ({
      issueId: getRequiredMapValue(
        issueIdByStagedId,
        transition.stagedIssueId,
        `Published issue is missing for staged history ${transition.stagedIssueId}.`,
      ),
      syncRunId: params.syncRunId,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      changedAt: transition.changedAt,
    })),
    returningColumns: ["id"],
    tx: params.tx,
    signal: params.signal,
    injectUpdatedAt: false,
  });

  await cleanupStagedSyncRun(params.tx, params.syncRunId);
}

async function acquireJiraConnectionLock(
  tx: Prisma.TransactionClient,
  jiraConnectionId: string,
) {
  await tx.$queryRaw<{ advisoryLock: string }[]>`
    SELECT pg_advisory_xact_lock(hashtext(${jiraConnectionId}))::text AS "advisoryLock"
  `;
}

async function cleanupStagedSyncRun(
  tx: Prisma.TransactionClient,
  syncRunId: string,
) {
  await Promise.all([
    tx.stagedJiraProject.deleteMany({
      where: {
        syncRunId,
      },
    }),
    tx.stagedAssignee.deleteMany({
      where: {
        syncRunId,
      },
    }),
    tx.stagedEpic.deleteMany({
      where: {
        syncRunId,
      },
    }),
    tx.stagedIssue.deleteMany({
      where: {
        syncRunId,
      },
    }),
    tx.stagedIssueStatusHistory.deleteMany({
      where: {
        syncRunId,
      },
    }),
  ]);
}

async function upsertJiraConnection(params: {
  runtime: ResolveJiraRuntimeConfigReturn;
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

async function publishSyncRun(params: {
  syncRunId: string;
  jiraConnectionId: string;
  signal?: AbortSignal;
}) {
  throwIfAborted(params.signal);

  const [stagedProjects, stagedAssignees, stagedEpics, stagedIssues, stagedIssueHistory] =
    await Promise.all([
      prisma.stagedJiraProject.findMany({
        where: { syncRunId: params.syncRunId },
        select: {
          id: true,
          jiraProjectId: true,
          key: true,
          name: true,
        },
      }),
      prisma.stagedAssignee.findMany({
        where: { syncRunId: params.syncRunId },
        select: {
          id: true,
          jiraAccountId: true,
          displayName: true,
          color: true,
        },
      }),
      prisma.stagedEpic.findMany({
        where: { syncRunId: params.syncRunId },
        select: {
          id: true,
          stagedProjectId: true,
          jiraEpicId: true,
          key: true,
          summary: true,
          status: true,
          rank: true,
          jiraUpdatedAt: true,
        },
      }),
      prisma.stagedIssue.findMany({
        where: { syncRunId: params.syncRunId },
        select: {
          id: true,
          stagedProjectId: true,
          stagedEpicId: true,
          stagedAssigneeId: true,
          jiraIssueId: true,
          key: true,
          summary: true,
          status: true,
          issueType: true,
          priority: true,
          dueAt: true,
          resolvedAt: true,
          startedAt: true,
          markerAt: true,
          markerKind: true,
          jiraCreatedAt: true,
          jiraUpdatedAt: true,
          rawPayload: true,
        },
      }),
      prisma.stagedIssueStatusHistory.findMany({
        where: { syncRunId: params.syncRunId },
        select: {
          stagedIssueId: true,
          fromStatus: true,
          toStatus: true,
          changedAt: true,
        },
      }),
    ]);

  const stagedProjectIds = new Set(stagedProjects.map((p) => p.id));
  const stagedAssigneeIds = new Set(stagedAssignees.map((a) => a.id));
  const stagedEpicIds = new Set(stagedEpics.map((e) => e.id));
  const stagedIssueIds = new Set(stagedIssues.map((i) => i.id));

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
    if (stagedIssue.stagedAssigneeId && !stagedAssigneeIds.has(stagedIssue.stagedAssigneeId)) {
      throw new Error("Staged issue references a missing staged assignee.");
    }
  }

  for (const transition of stagedIssueHistory) {
    if (!stagedIssueIds.has(transition.stagedIssueId)) {
      throw new Error("Staged issue history references a missing staged issue.");
    }
  }

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

    await publishLiveDataset({
      tx,
      syncRunId: params.syncRunId,
      jiraConnectionId: params.jiraConnectionId,
      stagedProjects,
      stagedAssignees,
      stagedEpics,
      stagedIssues,
      stagedIssueHistory,
      signal: params.signal,
    });

    await tx.jiraConnection.update({
      where: { id: params.jiraConnectionId },
      data: { activeSyncRunId: params.syncRunId },
    });

    await tx.syncRun.update({
      where: { id: params.syncRunId },
      data: {
        status: SyncStatus.SUCCEEDED,
        finishedAt: new Date(),
        errorMessage: null,
      },
    });

    const oldSyncRuns = await tx.syncRun.findMany({
      where: {
        jiraConnectionId: params.jiraConnectionId,
        status: SyncStatus.SUCCEEDED,
        id: { not: params.syncRunId },
      },
      select: { id: true },
      orderBy: { startedAt: "desc" },
      skip: KEEP_SYNC_RUNS - 1,
    });

    if (oldSyncRuns.length > 0) {
      await tx.syncRun.deleteMany({
        where: {
          id: { in: oldSyncRuns.map((r) => r.id) },
        },
      });
    }
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

export {
  acquireJiraConnectionLock,
  cleanupStagedSyncRun,
  upsertJiraConnection,
  publishSyncRun,
  failSyncRun,
};
