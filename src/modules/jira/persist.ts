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
import {
  normalizeTimelineTimezone,
  parseDateOnlyAtHourInTimezone,
} from "@/modules/timeline/date-helpers";
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

function parseJiraDate(value?: string | null, timezone?: string | null) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Keep Jira date-only values anchored to the connection's local calendar day.
    return parseDateOnlyAtHourInTimezone(
      value,
      normalizeTimelineTimezone(timezone),
      12,
    );
  }

  const parsed = new Date(value);

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

function isPlaceholderEpicId(jiraEpicId: string, key: string) {
  return jiraEpicId === key;
}

function isPlaceholderEpicSummary(summary: string, key: string) {
  const normalizedSummary = summary.trim();

  return normalizedSummary.length === 0 || normalizedSummary === key;
}

function mergeEpicSeeds(existing: EpicSeed, incoming: EpicSeed): EpicSeed {
  const existingIdIsPlaceholder = isPlaceholderEpicId(
    existing.jiraEpicId,
    existing.key,
  );
  const incomingIdIsPlaceholder = isPlaceholderEpicId(
    incoming.jiraEpicId,
    incoming.key,
  );

  return {
    jiraEpicId:
      existingIdIsPlaceholder && !incomingIdIsPlaceholder
        ? incoming.jiraEpicId
        : existing.jiraEpicId,
    key: incoming.key,
    summary: isPlaceholderEpicSummary(incoming.summary, incoming.key)
      ? existing.summary
      : incoming.summary,
    status: incoming.status === "Unknown" ? existing.status : incoming.status,
    jiraUpdatedAt: incoming.jiraUpdatedAt ?? existing.jiraUpdatedAt,
  };
}

const BULK_CHUNK_SIZE = 500;

/**
 * Bulk upsert via raw SQL with RETURNING.
 * Like bulkUpsertRaw but returns specified columns for FK resolution.
 * Chunks rows to stay under PostgreSQL's parameter limit (~65535).
 */
async function bulkUpsertReturning(params: {
  table: string;
  columns: string[];
  conflictColumns: string[];
  returningColumns: string[];
  rows: Record<string, unknown>[];
  signal?: AbortSignal;
  updateOverrides?: Record<string, string>;
  typeCasts?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const {
    table,
    columns,
    conflictColumns,
    returningColumns,
    rows,
    signal,
    updateOverrides,
    typeCasts,
  } = params;
  if (rows.length === 0) return [];

  const nonConflictColumns = columns.filter(
    (col) => !conflictColumns.includes(col),
  );

  const updateSet = nonConflictColumns
    .map((col) => {
      if (updateOverrides && col in updateOverrides) {
        return `"${col}" = ${updateOverrides[col]}`;
      }
      return `"${col}" = EXCLUDED."${col}"`;
    })
    .join(", ");

  const columnList = columns.map((col) => `"${col}"`).join(", ");
  const conflictList = conflictColumns
    .map((col) => `"${col}"`)
    .join(", ");
  const returningList = returningColumns
    .map((col) => `"${col}"`)
    .join(", ");

  const baseSql = `INSERT INTO "${table}" (${columnList}) VALUES %s ON CONFLICT (${conflictList}) DO UPDATE SET ${updateSet} RETURNING ${returningList}`;

  const allResults: Record<string, unknown>[] = [];

  for (let offset = 0; offset < rows.length; offset += BULK_CHUNK_SIZE) {
    throwIfAborted(signal);
    const chunk = rows.slice(offset, offset + BULK_CHUNK_SIZE);

    const allValues: unknown[] = [];
    const valueClauses: string[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        allValues.push(row[col] ?? null);
        const cast = typeCasts?.[col];
        rowPlaceholders.push(cast ? `$${paramIdx}::${cast}` : `$${paramIdx}`);
        paramIdx++;
      }
      valueClauses.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = baseSql.replace("%s", valueClauses.join(", "));
    const chunkResult = (await prisma.$queryRawUnsafe(
      sql,
      ...allValues,
    )) as Record<string, unknown>[];
    allResults.push(...chunkResult);
  }

  throwIfAborted(signal);
  return allResults;
}

/**
 * Bulk INSERT ... RETURNING for publish phase (inside $transaction).
 * No ON CONFLICT — publish uses delete-then-recreate pattern.
 */
async function rawSqlCreateReturning(params: {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  returningColumns: string[];
  tx: Prisma.TransactionClient;
  signal?: AbortSignal;
  typeCasts?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const { table, columns, rows, returningColumns, tx, signal, typeCasts } = params;
  if (rows.length === 0) return [];

  const columnList = columns.map((col) => `"${col}"`).join(", ");
  const returningList = returningColumns
    .map((col) => `"${col}"`)
    .join(", ");

  const baseSql = `INSERT INTO "${table}" (${columnList}) VALUES %s RETURNING ${returningList}`;

  const allResults: Record<string, unknown>[] = [];

  for (let offset = 0; offset < rows.length; offset += BULK_CHUNK_SIZE) {
    throwIfAborted(signal);
    const chunk = rows.slice(offset, offset + BULK_CHUNK_SIZE);

    const allValues: unknown[] = [];
    const valueClauses: string[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        allValues.push(row[col] ?? null);
        const cast = typeCasts?.[col];
        rowPlaceholders.push(cast ? `$${paramIdx}::${cast}` : `$${paramIdx}`);
        paramIdx++;
      }
      valueClauses.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = baseSql.replace("%s", valueClauses.join(", "));
    const chunkResult = (await tx.$queryRawUnsafe(
      sql,
      ...allValues,
    )) as Record<string, unknown>[];
    allResults.push(...chunkResult);
  }

  throwIfAborted(signal);
  return allResults;
}

type CollectedTransition = {
  jiraIssueId: string;
  jiraProjectId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
};

function collectEntities(
  issues: JiraIssue[],
  syncRunId: string,
  timezone: string,
  workflowRules: JiraWorkflowRules,
  epicLinkFieldId?: string,
  storyPointFieldIds?: string[],
  developmentFieldIds?: string[],
) {
  const projectMap = new Map<string, ProjectSeed>();
  const assigneeMap = new Map<string, {
    jiraAccountId: string;
    displayName: string;
    email: string | null;
    color: string;
  }>();
  const epicMap = new Map<string, EpicSeed>();
  const issueRecords: {
    jiraProjectId: string;
    jiraIssueId: string;
    jiraEpicKey: string | null;
    jiraAccountId: string | null;
    isEpic: boolean;
    key: string;
    summary: string;
    status: string;
    issueType: string;
    priority: string | null;
    dueAt: Date | null;
    resolvedAt: Date | null;
    startedAt: Date | null;
    markerAt: Date | null;
    markerKind: string;
    jiraCreatedAt: Date | null;
    jiraUpdatedAt: Date | null;
    rawPayload: Prisma.InputJsonValue;
  }[] = [];
  const transitionRecords: CollectedTransition[] = [];

  const epicLookup = buildEpicLookup(issues);

  for (const issue of issues) {
    // Project
    const projectSeed = buildProjectSeed(issue);
    projectMap.set(projectSeed.jiraProjectId, projectSeed);

    // Assignee
    const assigneeDetails = issue.fields.assignee;
    const assigneeIdentity = deriveAssigneeIdentity(assigneeDetails);
    if (assigneeDetails && assigneeIdentity) {
      assigneeMap.set(assigneeIdentity, {
        jiraAccountId: assigneeIdentity,
        displayName: assigneeDetails.displayName,
        email: assigneeDetails.emailAddress ?? null,
        color: deriveAssigneeColor(assigneeIdentity),
      });
    }

    // Epic
    const epicSeed =
      buildEpicSeed(issue) ??
      buildLinkedEpicSeed({ issue, epicLookup, epicLinkFieldId });
    const epicKey = epicSeed?.key ?? null;
    if (epicSeed) {
      const existingEpic = epicMap.get(epicSeed.key);
      epicMap.set(
        epicSeed.key,
        existingEpic ? mergeEpicSeeds(existingEpic, epicSeed) : epicSeed,
      );
    }

    // Issue
    const timelineFields = deriveTimelineFields(issue, workflowRules);
    issueRecords.push({
      jiraProjectId: projectSeed.jiraProjectId,
      jiraIssueId: issue.id,
      jiraEpicKey: epicKey,
      jiraAccountId: assigneeIdentity ?? null,
      isEpic: isEpicIssue(issue),
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name ?? "Unknown",
      issueType: issue.fields.issuetype?.name ?? "Unknown",
      priority: issue.fields.priority?.name ?? null,
      dueAt: parseJiraDate(issue.fields.duedate, timezone),
      resolvedAt: parseJiraDate(issue.fields.resolutiondate, timezone),
      startedAt: parseJiraDate(timelineFields.startAt, timezone),
      markerAt: parseJiraDate(timelineFields.markerAt, timezone),
      markerKind: toPrismaMarkerKind(timelineFields.markerKind),
      jiraCreatedAt: parseJiraDate(issue.fields.created, timezone),
      jiraUpdatedAt: parseJiraDate(issue.fields.updated, timezone),
      rawPayload: toPrismaJson(
        buildRawPayload(issue, storyPointFieldIds, developmentFieldIds),
      ),
    });

    // Transitions
    const statusTransitions = (issue.changelog?.histories ?? []).flatMap(
      (history) =>
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

    for (const t of statusTransitions) {
      if (t.changedAt) {
        transitionRecords.push({
          jiraIssueId: issue.id,
          jiraProjectId: projectSeed.jiraProjectId,
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          changedAt: t.changedAt,
        });
      }
    }
  }

  return { projectMap, assigneeMap, epicMap, issueRecords, transitionRecords };
}

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
      markerKind: "text",
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
          markerKind: "text",
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
