import { Prisma, SyncStatus } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";
import { rawSqlCreateReturning } from "@/modules/jira/bulk-sql";
type ResolveJiraRuntimeConfigReturn = Awaited<
  ReturnType<typeof import("@/modules/jira/client").resolveJiraRuntimeConfig>
>;

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

    if (stagedProjects.length > 0) {
      const projectRows = stagedProjects.map((sp) => ({
        jiraConnectionId: params.jiraConnectionId,
        jiraProjectId: sp.jiraProjectId,
        key: sp.key,
        name: sp.name,
      }));

      const projectResults = await rawSqlCreateReturning({
        table: "JiraProject",
        columns: ["jiraConnectionId", "jiraProjectId", "key", "name"],
        rows: projectRows,
        returningColumns: ["id"],
        tx,
        signal: params.signal,
      });

      for (let i = 0; i < stagedProjects.length; i++) {
        publishedProjectIds.set(stagedProjects[i].id, projectResults[i].id as string);
      }
    }

    const publishedAssigneeIds = new Map<string, string>();

    if (stagedAssignees.length > 0) {
      const assigneeRows = stagedAssignees.map((sa) => ({
        jiraConnectionId: params.jiraConnectionId,
        jiraAccountId: sa.jiraAccountId,
        displayName: sa.displayName,
        email: sa.email,
        color: sa.color,
      }));

      const assigneeResults = await rawSqlCreateReturning({
        table: "Assignee",
        columns: ["jiraConnectionId", "jiraAccountId", "displayName", "email", "color"],
        rows: assigneeRows,
        returningColumns: ["id"],
        tx,
        signal: params.signal,
      });

      for (let i = 0; i < stagedAssignees.length; i++) {
        publishedAssigneeIds.set(stagedAssignees[i].id, assigneeResults[i].id as string);
      }
    }

    const publishedEpicIds = new Map<string, string>();

    if (stagedEpics.length > 0) {
      const epicRows = stagedEpics.map((se) => {
        const jiraProjectId = publishedProjectIds.get(se.stagedProjectId);
        if (!jiraProjectId) {
          throw new Error("Unable to publish an epic without a project.");
        }
        return {
          jiraProjectId,
          jiraEpicId: se.jiraEpicId,
          key: se.key,
          summary: se.summary,
          status: se.status,
          rank: se.rank,
          jiraUpdatedAt: se.jiraUpdatedAt,
        };
      });

      const epicResults = await rawSqlCreateReturning({
        table: "Epic",
        columns: ["jiraProjectId", "jiraEpicId", "key", "summary", "status", "rank", "jiraUpdatedAt"],
        rows: epicRows,
        returningColumns: ["id"],
        tx,
        signal: params.signal,
      });

      for (let i = 0; i < stagedEpics.length; i++) {
        publishedEpicIds.set(stagedEpics[i].id, epicResults[i].id as string);
      }
    }

    const publishedIssueIds = new Map<string, string>();

    if (stagedIssues.length > 0) {
      const issueRows = stagedIssues.map((si) => {
        const jiraProjectId = publishedProjectIds.get(si.stagedProjectId);
        if (!jiraProjectId) {
          throw new Error("Unable to publish an issue without a project.");
        }
        const epicId = si.stagedEpicId
          ? publishedEpicIds.get(si.stagedEpicId)
          : null;
        if (si.stagedEpicId && !epicId) {
          throw new Error("Unable to publish an issue with a missing epic.");
        }
        const assigneeId = si.stagedAssigneeId
          ? publishedAssigneeIds.get(si.stagedAssigneeId)
          : null;
        if (si.stagedAssigneeId && !assigneeId) {
          throw new Error("Unable to publish an issue with a missing assignee.");
        }
        return {
          jiraProjectId,
          epicId,
          assigneeId,
          jiraIssueId: si.jiraIssueId,
          key: si.key,
          summary: si.summary,
          status: si.status,
          issueType: si.issueType,
          priority: si.priority,
          dueAt: si.dueAt,
          resolvedAt: si.resolvedAt,
          startedAt: si.startedAt,
          markerAt: si.markerAt,
          markerKind: si.markerKind,
          jiraCreatedAt: si.jiraCreatedAt,
          jiraUpdatedAt: si.jiraUpdatedAt,
          rawPayload: si.rawPayload,
        };
      });

      const issueResults = await rawSqlCreateReturning({
        table: "Issue",
        columns: [
          "jiraProjectId", "epicId", "assigneeId", "jiraIssueId", "key",
          "summary", "status", "issueType", "priority", "dueAt", "resolvedAt",
          "startedAt", "markerAt", "markerKind", "jiraCreatedAt", "jiraUpdatedAt",
          "rawPayload",
        ],
        rows: issueRows,
        returningColumns: ["id"],
        tx,
        signal: params.signal,
        typeCasts: {
          markerKind: '"TimelineMarkerKind"',
          rawPayload: "jsonb",
        },
      });

      for (let i = 0; i < stagedIssues.length; i++) {
        publishedIssueIds.set(stagedIssues[i].id, issueResults[i].id as string);
      }
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

export {
  acquireJiraConnectionLock,
  cleanupStagedSyncRun,
  upsertJiraConnection,
  publishSyncRun,
  failSyncRun,
};
