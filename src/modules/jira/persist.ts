import { SyncStatus } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import {
  resolveJiraRuntimeConfig,
  searchJiraIssuesPage,
} from "@/modules/jira/client";
import { throwIfAborted } from "@/modules/jira/abort";
import { bulkUpsertReturning } from "@/modules/jira/bulk-sql";
import { collectEntities } from "@/modules/jira/sync-entities";
import {
  acquireJiraConnectionLock,
  upsertJiraConnection,
  publishSyncRun,
  failSyncRun,
} from "@/modules/jira/sync-publish";
import type { JiraIssue } from "@/modules/jira/types";
import {
  resolveWorkflowRules,
  type JiraWorkflowRules,
} from "@/modules/jira/workflow-rules";

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

async function persistIssues(params: {
  syncRunId: string;
  timezone: string;
  issues: JiraIssue[];
  workflowRules: JiraWorkflowRules;
  epicLinkFieldId?: string;
  storyPointFieldIds?: string[];
  developmentFieldIds?: string[];
  signal?: AbortSignal;
}): Promise<PersistIssuesResult> {
  throwIfAborted(params.signal);

  // Phase A: Collect and deduplicate (pure JS, 0 queries)
  const collected = collectEntities(
    params.issues,
    params.syncRunId,
    params.timezone,
    params.workflowRules,
    params.epicLinkFieldId,
    params.storyPointFieldIds,
    params.developmentFieldIds,
  );

  // Phase B: Bulk upsert in FK dependency order

  // B1: Projects
  const projectRows = [...collected.projectMap.values()].map((p) => ({
    syncRunId: params.syncRunId,
    jiraProjectId: p.jiraProjectId,
    key: p.key,
    name: p.name,
  }));

  const projectResults = await bulkUpsertReturning({
    table: "StagedJiraProject",
    columns: ["syncRunId", "jiraProjectId", "key", "name"],
    conflictColumns: ["syncRunId", "jiraProjectId"],
    returningColumns: ["id", "jiraProjectId"],
    rows: projectRows,
    signal: params.signal,
  });

  const projectIdMap = new Map<string, string>();
  for (const row of projectResults) {
    projectIdMap.set(row.jiraProjectId as string, row.id as string);
  }

  // B2: Assignees
  const assigneeRows = [...collected.assigneeMap.values()].map((a) => ({
    syncRunId: params.syncRunId,
    jiraAccountId: a.jiraAccountId,
    displayName: a.displayName,
    email: a.email,
    color: a.color,
  }));

  const assigneeResults = await bulkUpsertReturning({
    table: "StagedAssignee",
    columns: ["syncRunId", "jiraAccountId", "displayName", "email", "color"],
    conflictColumns: ["syncRunId", "jiraAccountId"],
    returningColumns: ["id", "jiraAccountId"],
    rows: assigneeRows,
    signal: params.signal,
  });

  const assigneeIdMap = new Map<string, string>();
  for (const row of assigneeResults) {
    assigneeIdMap.set(row.jiraAccountId as string, row.id as string);
  }

  // B3: Epics — need stagedProjectId from B1
  const epicRows = [...collected.epicMap.values()].map((e) => {
    // Find which project this epic belongs to via issueRecords
    const issueWithEpic = collected.issueRecords.find(
      (i) => i.jiraEpicKey === e.key,
    );
    const stagedProjectId = issueWithEpic
      ? projectIdMap.get(issueWithEpic.jiraProjectId)!
      : "";

    return {
      syncRunId: params.syncRunId,
      stagedProjectId,
      jiraEpicId: e.jiraEpicId,
      key: e.key,
      summary: e.summary,
      status: e.status,
      jiraUpdatedAt: e.jiraUpdatedAt,
    };
  }).filter((r) => r.stagedProjectId);

  const epicResults = await bulkUpsertReturning({
    table: "StagedEpic",
    columns: [
      "syncRunId", "stagedProjectId", "jiraEpicId", "key",
      "summary", "status", "jiraUpdatedAt",
    ],
    conflictColumns: ["syncRunId", "stagedProjectId", "key"],
    returningColumns: ["id", "key"],
    rows: epicRows,
    signal: params.signal,
  });

  const epicIdMap = new Map<string, string>();
  for (const row of epicResults) {
    epicIdMap.set(row.key as string, row.id as string);
  }

  // B4: Issues — need stagedProjectId, stagedEpicId, stagedAssigneeId
  const issueRows = collected.issueRecords.map((i) => ({
    syncRunId: params.syncRunId,
    stagedProjectId: projectIdMap.get(i.jiraProjectId)!,
    stagedEpicId: i.isEpic ? null : (epicIdMap.get(i.jiraEpicKey ?? "") ?? null),
    stagedAssigneeId: i.jiraAccountId
      ? (assigneeIdMap.get(i.jiraAccountId) ?? null)
      : null,
    jiraIssueId: i.jiraIssueId,
    key: i.key,
    summary: i.summary,
    status: i.status,
    issueType: i.issueType,
    priority: i.priority,
    dueAt: i.dueAt,
    resolvedAt: i.resolvedAt,
    startedAt: i.startedAt,
    markerAt: i.markerAt,
    markerKind: i.markerKind,
    jiraCreatedAt: i.jiraCreatedAt,
    jiraUpdatedAt: i.jiraUpdatedAt,
    rawPayload: i.rawPayload,
  }));

  const issueResults = await bulkUpsertReturning({
    table: "StagedIssue",
    columns: [
      "syncRunId", "stagedProjectId", "stagedEpicId", "stagedAssigneeId",
      "jiraIssueId", "key", "summary", "status", "issueType", "priority",
      "dueAt", "resolvedAt", "startedAt", "markerAt", "markerKind",
      "jiraCreatedAt", "jiraUpdatedAt", "rawPayload",
    ],
    conflictColumns: ["syncRunId", "stagedProjectId", "jiraIssueId"],
    returningColumns: ["id", "jiraIssueId"],
    rows: issueRows,
    signal: params.signal,
    typeCasts: {
      markerKind: '"TimelineMarkerKind"',
      rawPayload: "jsonb",
    },
  });

  const issueIdMap = new Map<string, string>();
  for (const row of issueResults) {
    issueIdMap.set(row.jiraIssueId as string, row.id as string);
  }

  // B5: Transitions — need stagedIssueId from B4
  const transitionRows = collected.transitionRecords.map((t) => ({
    syncRunId: params.syncRunId,
    stagedIssueId: issueIdMap.get(t.jiraIssueId)!,
    fromStatus: t.fromStatus,
    toStatus: t.toStatus,
    changedAt: t.changedAt,
  })).filter((r) => r.stagedIssueId);

  await bulkUpsertReturning({
    table: "StagedIssueStatusHistory",
    columns: [
      "syncRunId", "stagedIssueId", "fromStatus", "toStatus", "changedAt",
    ],
    conflictColumns: ["syncRunId", "stagedIssueId", "changedAt", "toStatus"],
    returningColumns: ["id"],
    rows: transitionRows,
    signal: params.signal,
    injectUpdatedAt: false,
  });

  // Phase C: Build result from collected data
  const projectKeys = [...collected.projectMap.values()].map((p) => p.key);
  const epicKeys = [...collected.epicMap.keys()];
  const assigneeIds = [...collected.assigneeMap.keys()];

  return {
    projectsSynced: collected.projectMap.size,
    epicsSynced: collected.epicMap.size,
    assigneesSynced: collected.assigneeMap.size,
    issuesSynced: collected.issueRecords.length,
    statusTransitionsSynced: collected.transitionRecords.length,
    projectKeys,
    epicKeys,
    assigneeIds,
  };
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
      timezone: runtime.timezone,
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
