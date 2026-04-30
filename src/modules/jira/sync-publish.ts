import { Prisma, SyncStatus } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";
type ResolveJiraRuntimeConfigReturn = Awaited<
  ReturnType<typeof import("@/modules/jira/client").resolveJiraRuntimeConfig>
>;

/** Number of completed sync runs to keep per connection (older ones are cleaned up). */
const KEEP_SYNC_RUNS = 5;

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

    // FK integrity check — verify staged data references are consistent
    const stagedProjects = await tx.stagedJiraProject.findMany({
      where: { syncRunId: params.syncRunId },
      select: { id: true },
    });
    const stagedAssignees = await tx.stagedAssignee.findMany({
      where: { syncRunId: params.syncRunId },
      select: { id: true },
    });
    const stagedEpics = await tx.stagedEpic.findMany({
      where: { syncRunId: params.syncRunId },
      select: { id: true, stagedProjectId: true },
    });
    const stagedIssues = await tx.stagedIssue.findMany({
      where: { syncRunId: params.syncRunId },
      select: {
        id: true,
        stagedProjectId: true,
        stagedEpicId: true,
        stagedAssigneeId: true,
      },
    });
    const stagedIssueHistory = await tx.stagedIssueStatusHistory.findMany({
      where: { syncRunId: params.syncRunId },
      select: { id: true, stagedIssueId: true },
    });

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

    // Active pointer switch — update JiraConnection to point to this sync run
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

    // Cleanup old sync runs — keep only the N most recent succeeded runs
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
