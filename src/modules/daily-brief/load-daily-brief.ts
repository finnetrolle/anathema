import {
  DailyBriefImportance as PrismaDailyBriefImportance,
  DailyBriefItemType as PrismaDailyBriefItemType,
  DailyBriefRunStatus,
  DailyBriefScopeType as PrismaDailyBriefScopeType,
  Prisma,
  SyncStatus,
} from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "@/modules/db/prisma";
import { isDoneStatus, isInProgressStatus } from "@/modules/jira/derive";
import { resolveWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  getEndOfDay,
  getStartOfDay,
  normalizeTimelineTimezone,
  toDateInputValue,
} from "@/modules/timeline/date-helpers";

import {
  buildIssueUrl,
  deriveAssigneeHistory,
  deriveComponentName,
  deriveDevelopmentSummary,
  deriveEstimateHours,
  deriveEstimateStoryPoints,
  deriveObservedPeople,
  deriveStatusCategoryKey,
  sortChangelogHistories,
} from "./issue-signals";
import type {
  DailyBriefCounts,
  DailyBriefDashboard,
  DailyBriefHistoryEntry,
  DailyBriefImportance,
  DailyBriefItemDetails,
  DailyBriefItemType,
  DailyBriefScope,
  DailyBriefScopeType,
  DailyBriefSummary,
  DailyBriefView,
  DailyBriefViewItem,
  DailyBriefWindow,
  DailyBriefWindowPreset,
} from "./types";

const TEAM_SCOPE_FALLBACK_KEY = "team";
const HISTORY_LIMIT = 12;

const dailyBriefIssueSelect = {
  id: true,
  jiraIssueId: true,
  key: true,
  summary: true,
  status: true,
  dueAt: true,
  resolvedAt: true,
  startedAt: true,
  markerAt: true,
  markerKind: true,
  jiraUpdatedAt: true,
  rawPayload: true,
  assignee: {
    select: {
      jiraAccountId: true,
      displayName: true,
      color: true,
    },
  },
  epic: {
    select: {
      key: true,
      summary: true,
    },
  },
  project: {
    select: {
      key: true,
      name: true,
      connection: {
        select: {
          id: true,
          name: true,
          baseUrl: true,
          timezone: true,
          workflowRules: true,
        },
      },
    },
  },
} satisfies Prisma.IssueSelect;

type DailyBriefSourceIssue = Prisma.IssueGetPayload<{
  select: typeof dailyBriefIssueSelect;
}>;

const dailyBriefRunSelect = {
  id: true,
  jiraConnectionId: true,
  generatedForDate: true,
  windowStart: true,
  windowEnd: true,
  scopeType: true,
  scopeKey: true,
  scopeLabel: true,
  status: true,
  summaryJson: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: [
      {
        importance: "desc",
      },
      {
        issueKey: "asc",
      },
      {
        headline: "asc",
      },
    ],
    select: {
      id: true,
      issueJiraId: true,
      issueKey: true,
      issueSummary: true,
      issueUrl: true,
      assigneeName: true,
      projectKey: true,
      projectName: true,
      epicKey: true,
      epicSummary: true,
      componentName: true,
      itemType: true,
      importance: true,
      headline: true,
      detailsJson: true,
      createdAt: true,
    },
  },
} satisfies Prisma.DailyBriefRunSelect;

type PersistedDailyBriefRun = Prisma.DailyBriefRunGetPayload<{
  select: typeof dailyBriefRunSelect;
}>;

const dailyBriefProjectOptionSelect = {
  key: true,
  name: true,
  connection: {
    select: {
      id: true,
      name: true,
      timezone: true,
    },
  },
} satisfies Prisma.JiraProjectSelect;

const dailyBriefPersonOptionSelect = {
  jiraAccountId: true,
  displayName: true,
  color: true,
  connection: {
    select: {
      id: true,
      name: true,
      timezone: true,
    },
  },
} satisfies Prisma.AssigneeSelect;

type DailyBriefPersonOption = Prisma.AssigneeGetPayload<{
  select: typeof dailyBriefPersonOptionSelect;
}>;

type DailyBriefStatusTransition = {
  changedAt: Date;
  fromStatus: string | null;
  toStatus: string;
};

type DailyBriefAssigneeTransition = {
  changedAt: Date;
  fromAssigneeName: string | null;
  toAssigneeName: string | null;
};

export type DailyBriefIssueSnapshot = {
  issueJiraId: string | null;
  issueKey: string;
  issueSummary: string;
  issueUrl: string | null;
  assigneeAccountId: string | null;
  assigneeName: string;
  assigneeColor: string;
  projectKey: string;
  projectName: string;
  epicKey: string | null;
  epicSummary: string | null;
  componentName: string;
  status: string;
  isCompleted: boolean;
  isInProgress: boolean;
  startAt: Date | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  completedAt: Date | null;
  jiraUpdatedAt: Date | null;
  estimateHours: number | null;
  estimateStoryPoints: number | null;
  assigneeHistory: string[];
  observedPeople: string[];
  pullRequestStatus: DailyBriefItemDetails["pullRequestStatus"];
  pullRequestCount: number;
  commitCount: number;
  statusTransitions: DailyBriefStatusTransition[];
  assigneeTransitions: DailyBriefAssigneeTransition[];
};

type DailyBriefGenerationInput = {
  scope: DailyBriefScope;
  window: DailyBriefWindow;
  syncRunId?: string | null;
};

type DailyBriefGenerationResult = DailyBriefView;

type LoadDailyBriefDashboardInput = {
  scopeType?: string;
  project?: string;
  person?: string;
  preset?: string;
  from?: string;
  to?: string;
  regenerate?: boolean;
  actionableOnly?: boolean;
  now?: Date;
};

function buildTeamScopeKey(connectionId: string) {
  return connectionId || TEAM_SCOPE_FALLBACK_KEY;
}

function buildProjectScopeKey(connectionId: string, projectKey: string) {
  return `${connectionId}:${projectKey}`;
}

function buildPersonScopeKey(connectionId: string, jiraAccountId: string) {
  return `${connectionId}:${jiraAccountId}`;
}

function splitScopeKey(scopeKey: string) {
  const separatorIndex = scopeKey.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    connectionId: scopeKey.slice(0, separatorIndex),
    entityKey: scopeKey.slice(separatorIndex + 1),
  };
}

function normalizeScopeType(value?: string | null): DailyBriefScopeType {
  if (value === "PROJECT" || value === "PERSON") {
    return value;
  }

  return "TEAM";
}

function normalizeWindowPreset(value?: string | null): DailyBriefWindowPreset {
  if (value === "LAST_24H" || value === "CUSTOM") {
    return value;
  }

  return "PREVIOUS_BUSINESS_DAY";
}

function normalizeActionableOnly(value?: boolean) {
  return Boolean(value);
}

function toPrismaJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isWithinWindow(value: Date | null, window: DailyBriefWindow) {
  return Boolean(
    value &&
      value.getTime() >= window.start.getTime() &&
      value.getTime() <= window.end.getTime(),
  );
}

function toIso(value: Date | null | undefined) {
  return isValidDate(value) ? value.toISOString() : null;
}

function parseWindowDateInput(
  value: string | undefined,
  timezone: string,
  boundary: "start" | "end",
) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return boundary === "start"
    ? getStartOfDay(new Date(`${value}T12:00:00.000Z`), timezone)
    : getEndOfDay(new Date(`${value}T12:00:00.000Z`), timezone);
}

function formatWindowLabel(preset: DailyBriefWindowPreset, start: Date, end: Date, timezone: string) {
  const startLabel = toDateInputValue(start, timezone);
  const endLabel = toDateInputValue(end, timezone);

  if (preset === "LAST_24H") {
    return "Last 24 hours";
  }

  if (preset === "PREVIOUS_BUSINESS_DAY") {
    return `Since previous business day (${startLabel} -> ${endLabel})`;
  }

  return `${startLabel} -> ${endLabel}`;
}

function resolvePreviousBusinessDayStart(now: Date, timezone: string) {
  let zoned = DateTime.fromJSDate(now, {
    zone: normalizeTimelineTimezone(timezone),
  }).startOf("day");

  do {
    zoned = zoned.minus({
      days: 1,
    });
  } while (zoned.weekday > 5);

  return zoned.toUTC().toJSDate();
}

export function resolveDailyBriefWindow(params: {
  preset?: string;
  from?: string;
  to?: string;
  timezone: string;
  now?: Date;
}): DailyBriefWindow {
  const timezone = normalizeTimelineTimezone(params.timezone);
  const preset = normalizeWindowPreset(params.preset);
  const now = params.now ?? new Date();
  const zonedNow = DateTime.fromJSDate(now, {
    zone: timezone,
  });

  let start: Date;
  let end: Date;

  if (preset === "CUSTOM") {
    const customStart = parseWindowDateInput(params.from, timezone, "start");
    const customEnd = parseWindowDateInput(params.to, timezone, "end");

    if (customStart && customEnd && customStart.getTime() <= customEnd.getTime()) {
      start = customStart;
      end = customEnd;
    } else {
      start = resolvePreviousBusinessDayStart(now, timezone);
      end = getStartOfDay(now, timezone);
    }
  } else if (preset === "LAST_24H") {
    const roundedEnd = zonedNow.startOf("hour");

    end = roundedEnd.toUTC().toJSDate();
    start = roundedEnd.minus({
      hours: 24,
    }).toUTC().toJSDate();
  } else {
    start = resolvePreviousBusinessDayStart(now, timezone);
    end = getStartOfDay(now, timezone);
  }

  return {
    preset,
    start,
    end,
    label: formatWindowLabel(preset, start, end, timezone),
    startInput: toDateInputValue(start, timezone),
    endInput: toDateInputValue(end, timezone),
  };
}

function deriveImportance(
  itemType: DailyBriefItemType,
  issue: DailyBriefIssueSnapshot,
) {
  switch (itemType) {
    case "OVERDUE":
    case "REOPENED":
    case "STALE_IN_PROGRESS":
      return "HIGH" satisfies DailyBriefImportance;
    case "OWNERSHIP_CHANGED":
      return issue.isInProgress ? "HIGH" : "MEDIUM";
    case "MISSING_DUE_DATE":
    case "MISSING_ESTIMATE":
    case "NO_CODE_ACTIVITY":
    case "DONE_WITHOUT_PR":
      return "MEDIUM" satisfies DailyBriefImportance;
    default:
      return "LOW" satisfies DailyBriefImportance;
  }
}

function sortDailyBriefItems(items: DailyBriefViewItem[]) {
  const importanceRank: Record<DailyBriefImportance, number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  return [...items].sort((left, right) => {
    const importanceDelta =
      importanceRank[right.importance] - importanceRank[left.importance];

    if (importanceDelta !== 0) {
      return importanceDelta;
    }

    const leftChangedAt =
      left.details.changedAt ?? left.details.resolvedAt ?? left.details.startAt;
    const rightChangedAt =
      right.details.changedAt ?? right.details.resolvedAt ?? right.details.startAt;

    if (rightChangedAt !== leftChangedAt) {
      return (leftChangedAt ?? "").localeCompare(rightChangedAt ?? "");
    }

    return left.issueKey.localeCompare(right.issueKey);
  });
}

function hasResolvedPersonConnection(
  person: DailyBriefPersonOption,
): person is DailyBriefPersonOption & {
  connection: NonNullable<DailyBriefPersonOption["connection"]>;
} {
  return Boolean(person.connection);
}

function buildSections(items: DailyBriefViewItem[]) {
  const completed = sortDailyBriefItems(
    items.filter((item) => item.itemType === "COMPLETED"),
  );
  const started = sortDailyBriefItems(
    items.filter((item) => item.itemType === "STARTED"),
  );
  const ownershipChanges = sortDailyBriefItems(
    items.filter((item) => item.itemType === "OWNERSHIP_CHANGED"),
  );
  const needsAttention = sortDailyBriefItems(
    items.filter(
      (item) =>
        !["COMPLETED", "STARTED", "OWNERSHIP_CHANGED"].includes(item.itemType),
    ),
  );
  const topicsForStandup = sortDailyBriefItems(
    items.filter((item) =>
      [
        "REOPENED",
        "OVERDUE",
        "STALE_IN_PROGRESS",
        "OWNERSHIP_CHANGED",
        "DONE_WITHOUT_PR",
      ].includes(item.itemType),
    ),
  );

  return {
    completed,
    started,
    needsAttention,
    ownershipChanges,
    topicsForStandup,
  };
}

function buildCounts(items: DailyBriefViewItem[]) {
  const sections = buildSections(items);
  const people = new Set(items.map((item) => item.assigneeName).filter(Boolean));

  return {
    counts: {
      completedCount: sections.completed.length,
      startedCount: sections.started.length,
      attentionCount: sections.needsAttention.length,
      ownershipChangesCount: sections.ownershipChanges.length,
      peopleCovered: people.size,
    } satisfies DailyBriefCounts,
    sections,
    people: [...people].sort((left, right) => left.localeCompare(right)),
  };
}

function buildHeadline(scope: DailyBriefScope, counts: DailyBriefCounts) {
  return `${scope.label}: ${counts.completedCount} completed, ${counts.startedCount} started, ${counts.attentionCount} need attention`;
}

function readDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractTransitions(issue: DailyBriefSourceIssue) {
  const statusTransitions: DailyBriefStatusTransition[] = [];
  const assigneeTransitions: DailyBriefAssigneeTransition[] = [];

  for (const history of sortChangelogHistories(issue.rawPayload)) {
    const changedAt = readDate(history.created);

    if (!changedAt) {
      continue;
    }

    for (const item of history.items ?? []) {
      const field = item.field?.toLowerCase();

      if (field === "status" && item.toString) {
        statusTransitions.push({
          changedAt,
          fromStatus: item.fromString ?? null,
          toStatus: item.toString,
        });
      }

      if (field === "assignee") {
        assigneeTransitions.push({
          changedAt,
          fromAssigneeName: item.fromString?.trim() || null,
          toAssigneeName: item.toString?.trim() || null,
        });
      }
    }
  }

  return {
    statusTransitions,
    assigneeTransitions,
  };
}

function toIssueSnapshot(issue: DailyBriefSourceIssue) {
  const workflowRules = resolveWorkflowRules(issue.project.connection.workflowRules, {
    connectionId: issue.project.connection.id,
    connectionName: issue.project.connection.name,
  });
  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  const assigneeName = issue.assignee?.displayName ?? "Unassigned";
  const assigneeHistory = deriveAssigneeHistory(issue.rawPayload, assigneeName);
  const observedPeople = deriveObservedPeople(issue.rawPayload, assigneeName);
  const developmentSummary = deriveDevelopmentSummary(issue.rawPayload);
  const { statusTransitions, assigneeTransitions } = extractTransitions(issue);
  const completedAt =
    issue.resolvedAt ??
    (issue.markerKind === "DONE" ? issue.markerAt : null) ??
    null;

  return {
    issueJiraId: issue.jiraIssueId,
    issueKey: issue.key,
    issueSummary: issue.summary,
    issueUrl: buildIssueUrl(issue.project.connection.baseUrl, issue.key),
    assigneeAccountId: issue.assignee?.jiraAccountId ?? null,
    assigneeName,
    assigneeColor: issue.assignee?.color ?? "#8ec5ff",
    projectKey: issue.project.key,
    projectName: issue.project.name,
    epicKey: issue.epic?.key ?? null,
    epicSummary: issue.epic?.summary ?? null,
    componentName: deriveComponentName(issue.rawPayload),
    status: issue.status,
    isCompleted: isDoneStatus(issue.status, workflowRules, statusCategoryKey),
    isInProgress: isInProgressStatus(issue.status, workflowRules, statusCategoryKey),
    startAt: issue.startedAt,
    dueAt: issue.dueAt,
    resolvedAt: issue.resolvedAt,
    completedAt,
    jiraUpdatedAt: issue.jiraUpdatedAt,
    estimateHours: deriveEstimateHours(issue.rawPayload),
    estimateStoryPoints: deriveEstimateStoryPoints(issue.rawPayload),
    assigneeHistory,
    observedPeople,
    pullRequestStatus: developmentSummary.pullRequestStatus,
    pullRequestCount: developmentSummary.pullRequestCount,
    commitCount: developmentSummary.commitCount,
    statusTransitions,
    assigneeTransitions,
  } satisfies DailyBriefIssueSnapshot;
}

function buildItem(
  issue: DailyBriefIssueSnapshot,
  itemType: DailyBriefItemType,
  details: Partial<DailyBriefItemDetails> & Pick<DailyBriefItemDetails, "reason">,
) {
  const importance = deriveImportance(itemType, issue);

  const headlineByType: Record<DailyBriefItemType, string> = {
    COMPLETED: `${issue.issueKey} completed`,
    STARTED: `${issue.issueKey} moved into progress`,
    STALE_IN_PROGRESS: `${issue.issueKey} looks stuck`,
    OVERDUE: `${issue.issueKey} is overdue`,
    MISSING_DUE_DATE: `${issue.issueKey} has no due date`,
    MISSING_ESTIMATE: `${issue.issueKey} has no estimate`,
    NO_CODE_ACTIVITY: `${issue.issueKey} has no code activity`,
    OWNERSHIP_CHANGED: `${issue.issueKey} changed assignee`,
    DONE_WITHOUT_PR: `${issue.issueKey} was done without a PR`,
    REOPENED: `${issue.issueKey} was reopened`,
  };

  return {
    id: `${itemType}:${issue.issueKey}`,
    issueJiraId: issue.issueJiraId,
    issueKey: issue.issueKey,
    issueSummary: issue.issueSummary,
    issueUrl: issue.issueUrl,
    assigneeName: issue.assigneeName,
    projectKey: issue.projectKey,
    projectName: issue.projectName,
    epicKey: issue.epicKey,
    epicSummary: issue.epicSummary,
    componentName: issue.componentName,
    itemType,
    importance,
    headline: headlineByType[itemType],
    details: {
      reason: details.reason,
      startAt: details.startAt ?? toIso(issue.startAt),
      dueAt: details.dueAt ?? toIso(issue.dueAt),
      resolvedAt: details.resolvedAt ?? toIso(issue.resolvedAt),
      status: issue.status,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      epicKey: issue.epicKey,
      epicSummary: issue.epicSummary,
      componentName: issue.componentName,
      assigneeHistory: issue.assigneeHistory,
      observedPeople: issue.observedPeople,
      estimateHours: issue.estimateHours,
      estimateStoryPoints: issue.estimateStoryPoints,
      commitCount: issue.commitCount,
      pullRequestCount: issue.pullRequestCount,
      pullRequestStatus: issue.pullRequestStatus,
      currentAssigneeName: issue.assigneeName,
      changedAt: details.changedAt ?? null,
      previousAssigneeName: details.previousAssigneeName ?? null,
      nextAssigneeName: details.nextAssigneeName ?? null,
    },
    createdAt: new Date().toISOString(),
  } satisfies DailyBriefViewItem;
}

function dedupePushItem(
  target: DailyBriefViewItem[],
  item: DailyBriefViewItem,
  seen: Set<string>,
) {
  const dedupeKey = `${item.itemType}:${item.issueKey}`;

  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  target.push(item);
}

export function deriveDailyBriefItemsForIssue(
  issue: DailyBriefIssueSnapshot,
  window: DailyBriefWindow,
) {
  const items: DailyBriefViewItem[] = [];
  const seen = new Set<string>();
  const statusTransitionsInWindow = issue.statusTransitions.filter((transition) =>
    isWithinWindow(transition.changedAt, window),
  );
  const assigneeTransitionsInWindow = issue.assigneeTransitions.filter((transition) =>
    isWithinWindow(transition.changedAt, window),
  );
  const startedInWindow =
    isWithinWindow(issue.startAt, window) ||
    statusTransitionsInWindow.some(
      (transition) =>
        !isDoneStatus(transition.toStatus) &&
        isInProgressStatus(transition.toStatus) &&
        !isInProgressStatus(transition.fromStatus),
    );
  const completedInWindow = issue.isCompleted && isWithinWindow(issue.completedAt, window);
  const reopenedTransition = statusTransitionsInWindow.find(
    (transition) =>
      isDoneStatus(transition.fromStatus) && !isDoneStatus(transition.toStatus),
  );
  const latestAssigneeTransition = assigneeTransitionsInWindow.at(-1);
  const hasCodeActivity = issue.pullRequestCount > 0 || issue.commitCount > 0;
  const hasStatusMovementInWindow = statusTransitionsInWindow.length > 0;
  const overdue = Boolean(
    issue.dueAt &&
      !issue.isCompleted &&
      issue.dueAt.getTime() < window.end.getTime(),
  );
  const missingEstimate =
    issue.isInProgress &&
    issue.estimateHours === null &&
    issue.estimateStoryPoints === null;
  const missingDueDate = issue.isInProgress && !issue.dueAt;
  const staleInProgress = Boolean(
    issue.isInProgress &&
      !issue.isCompleted &&
      issue.startAt &&
      issue.startAt.getTime() < window.start.getTime() &&
      !hasStatusMovementInWindow &&
      !hasCodeActivity,
  );

  if (completedInWindow) {
    dedupePushItem(
      items,
      buildItem(issue, "COMPLETED", {
        reason: "Issue moved into done during the selected window.",
        changedAt: toIso(issue.completedAt),
      }),
      seen,
    );
  }

  if (startedInWindow) {
    dedupePushItem(
      items,
      buildItem(issue, "STARTED", {
        reason: "Issue moved into active work during the selected window.",
        changedAt: toIso(issue.startAt),
      }),
      seen,
    );
  }

  if (reopenedTransition) {
    dedupePushItem(
      items,
      buildItem(issue, "REOPENED", {
        reason: `Issue moved from "${reopenedTransition.fromStatus ?? "Done"}" back to "${reopenedTransition.toStatus}".`,
        changedAt: reopenedTransition.changedAt.toISOString(),
      }),
      seen,
    );
  }

  if (overdue) {
    dedupePushItem(
      items,
      buildItem(issue, "OVERDUE", {
        reason: "Issue is still open past its due date.",
        changedAt: toIso(issue.dueAt),
      }),
      seen,
    );
  }

  if (staleInProgress) {
    dedupePushItem(
      items,
      buildItem(issue, "STALE_IN_PROGRESS", {
        reason: "Issue stayed in progress with no status movement or code activity in the selected window.",
      }),
      seen,
    );
  } else if (issue.isInProgress && !issue.isCompleted && !hasCodeActivity) {
    dedupePushItem(
      items,
      buildItem(issue, "NO_CODE_ACTIVITY", {
        reason: "Issue is in progress but has no linked commits or pull requests.",
      }),
      seen,
    );
  }

  if (missingDueDate) {
    dedupePushItem(
      items,
      buildItem(issue, "MISSING_DUE_DATE", {
        reason: "Issue is in progress without a due date.",
      }),
      seen,
    );
  }

  if (missingEstimate) {
    dedupePushItem(
      items,
      buildItem(issue, "MISSING_ESTIMATE", {
        reason: "Issue is in progress without an estimate.",
      }),
      seen,
    );
  }

  if (latestAssigneeTransition) {
    dedupePushItem(
      items,
      buildItem(issue, "OWNERSHIP_CHANGED", {
        reason: `Ownership changed from "${latestAssigneeTransition.fromAssigneeName ?? "Unassigned"}" to "${latestAssigneeTransition.toAssigneeName ?? issue.assigneeName}".`,
        changedAt: latestAssigneeTransition.changedAt.toISOString(),
        previousAssigneeName: latestAssigneeTransition.fromAssigneeName,
        nextAssigneeName: latestAssigneeTransition.toAssigneeName,
      }),
      seen,
    );
  }

  if (completedInWindow && issue.pullRequestCount === 0) {
    dedupePushItem(
      items,
      buildItem(issue, "DONE_WITHOUT_PR", {
        reason: "Issue reached done without any linked pull request activity.",
        changedAt: toIso(issue.completedAt),
      }),
      seen,
    );
  }

  return items;
}

function buildDailyBriefView(params: {
  id: string;
  scope: DailyBriefScope;
  window: DailyBriefWindow;
  status: "SUCCEEDED" | "FAILED";
  items: DailyBriefViewItem[];
  createdAt: string;
  updatedAt: string;
}) {
  const sortedItems = sortDailyBriefItems(params.items);
  const aggregate = buildCounts(sortedItems);
  const summary = {
    headline: buildHeadline(params.scope, aggregate.counts),
    generatedAt: params.updatedAt,
    generatedForDate: getStartOfDay(params.window.end, params.scope.timezone).toISOString(),
    windowStart: params.window.start.toISOString(),
    windowEnd: params.window.end.toISOString(),
    counts: aggregate.counts,
    people: aggregate.people,
  } satisfies DailyBriefSummary;

  return {
    id: params.id,
    scope: params.scope,
    window: params.window,
    status: params.status,
    summary,
    items: sortedItems,
    sections: aggregate.sections,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  } satisfies DailyBriefView;
}

function readDailyBriefSummary(summaryJson: Prisma.JsonValue): DailyBriefSummary | null {
  if (!summaryJson || typeof summaryJson !== "object" || Array.isArray(summaryJson)) {
    return null;
  }

  const summary = summaryJson as Record<string, unknown>;
  const counts = summary.counts as Record<string, unknown> | undefined;

  if (typeof summary.headline !== "string") {
    return null;
  }

  return {
    headline: summary.headline,
    generatedAt: typeof summary.generatedAt === "string" ? summary.generatedAt : "",
    generatedForDate:
      typeof summary.generatedForDate === "string" ? summary.generatedForDate : "",
    windowStart: typeof summary.windowStart === "string" ? summary.windowStart : "",
    windowEnd: typeof summary.windowEnd === "string" ? summary.windowEnd : "",
    counts: {
      completedCount:
        typeof counts?.completedCount === "number" ? counts.completedCount : 0,
      startedCount: typeof counts?.startedCount === "number" ? counts.startedCount : 0,
      attentionCount:
        typeof counts?.attentionCount === "number" ? counts.attentionCount : 0,
      ownershipChangesCount:
        typeof counts?.ownershipChangesCount === "number"
          ? counts.ownershipChangesCount
          : 0,
      peopleCovered:
        typeof counts?.peopleCovered === "number" ? counts.peopleCovered : 0,
    },
    people: Array.isArray(summary.people)
      ? summary.people.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function readItemDetailsJson(detailsJson: Prisma.JsonValue): DailyBriefItemDetails {
  if (!detailsJson || typeof detailsJson !== "object" || Array.isArray(detailsJson)) {
    return {
      reason: "",
      startAt: null,
      dueAt: null,
      resolvedAt: null,
      status: "Unknown",
      projectKey: "",
      projectName: "",
      epicKey: null,
      epicSummary: null,
      componentName: "No component",
      assigneeHistory: [],
      observedPeople: [],
      estimateHours: null,
      estimateStoryPoints: null,
      commitCount: 0,
      pullRequestCount: 0,
      pullRequestStatus: "NONE",
      currentAssigneeName: "Unassigned",
      changedAt: null,
      previousAssigneeName: null,
      nextAssigneeName: null,
    };
  }

  const details = detailsJson as Record<string, unknown>;

  return {
    reason: typeof details.reason === "string" ? details.reason : "",
    startAt: typeof details.startAt === "string" ? details.startAt : null,
    dueAt: typeof details.dueAt === "string" ? details.dueAt : null,
    resolvedAt: typeof details.resolvedAt === "string" ? details.resolvedAt : null,
    status: typeof details.status === "string" ? details.status : "Unknown",
    projectKey: typeof details.projectKey === "string" ? details.projectKey : "",
    projectName: typeof details.projectName === "string" ? details.projectName : "",
    epicKey: typeof details.epicKey === "string" ? details.epicKey : null,
    epicSummary:
      typeof details.epicSummary === "string" ? details.epicSummary : null,
    componentName:
      typeof details.componentName === "string"
        ? details.componentName
        : "No component",
    assigneeHistory: Array.isArray(details.assigneeHistory)
      ? details.assigneeHistory.filter((value): value is string => typeof value === "string")
      : [],
    observedPeople: Array.isArray(details.observedPeople)
      ? details.observedPeople.filter((value): value is string => typeof value === "string")
      : [],
    estimateHours:
      typeof details.estimateHours === "number" ? details.estimateHours : null,
    estimateStoryPoints:
      typeof details.estimateStoryPoints === "number"
        ? details.estimateStoryPoints
        : null,
    commitCount: typeof details.commitCount === "number" ? details.commitCount : 0,
    pullRequestCount:
      typeof details.pullRequestCount === "number" ? details.pullRequestCount : 0,
    pullRequestStatus:
      details.pullRequestStatus === "OPEN" ||
      details.pullRequestStatus === "MERGED" ||
      details.pullRequestStatus === "DECLINED"
        ? details.pullRequestStatus
        : "NONE",
    currentAssigneeName:
      typeof details.currentAssigneeName === "string"
        ? details.currentAssigneeName
        : "Unassigned",
    changedAt: typeof details.changedAt === "string" ? details.changedAt : null,
    previousAssigneeName:
      typeof details.previousAssigneeName === "string"
        ? details.previousAssigneeName
        : null,
    nextAssigneeName:
      typeof details.nextAssigneeName === "string" ? details.nextAssigneeName : null,
  };
}

function toScopeFromPersistedRun(run: PersistedDailyBriefRun, timezone: string, connectionName: string) {
  return {
    type: run.scopeType as DailyBriefScopeType,
    key: run.scopeKey,
    label: run.scopeLabel,
    connectionId: run.jiraConnectionId,
    connectionName,
    timezone,
  } satisfies DailyBriefScope;
}

function toDailyBriefView(run: PersistedDailyBriefRun, scope: DailyBriefScope): DailyBriefView {
  const summary = readDailyBriefSummary(run.summaryJson);
  const items = sortDailyBriefItems(
    run.items.map((item) => ({
      id: item.id,
      issueJiraId: item.issueJiraId,
      issueKey: item.issueKey,
      issueSummary: item.issueSummary,
      issueUrl: item.issueUrl,
      assigneeName: item.assigneeName,
      projectKey: item.projectKey,
      projectName: item.projectName,
      epicKey: item.epicKey,
      epicSummary: item.epicSummary,
      componentName: item.componentName,
      itemType: item.itemType as DailyBriefItemType,
      importance: item.importance as DailyBriefImportance,
      headline: item.headline,
      details: readItemDetailsJson(item.detailsJson),
      createdAt: item.createdAt.toISOString(),
    })),
  );
  const sections = buildSections(items);
  const window = {
    preset: "CUSTOM",
    start: run.windowStart,
    end: run.windowEnd,
    label: formatWindowLabel("CUSTOM", run.windowStart, run.windowEnd, scope.timezone),
    startInput: toDateInputValue(run.windowStart, scope.timezone),
    endInput: toDateInputValue(run.windowEnd, scope.timezone),
  } satisfies DailyBriefWindow;
  const fallbackAggregate = buildCounts(items);

  return {
    id: run.id,
    scope,
    window,
    status: run.status,
    summary:
      summary ?? {
        headline: buildHeadline(scope, fallbackAggregate.counts),
        generatedAt: run.updatedAt.toISOString(),
        generatedForDate: run.generatedForDate.toISOString(),
        windowStart: run.windowStart.toISOString(),
        windowEnd: run.windowEnd.toISOString(),
        counts: fallbackAggregate.counts,
        people: fallbackAggregate.people,
      },
    items,
    sections,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

async function findConnection(connectionId: string) {
  return prisma.jiraConnection.findUnique({
    where: {
      id: connectionId,
    },
    select: {
      id: true,
      name: true,
      timezone: true,
      workflowRules: true,
    },
  });
}

async function resolveExistingDailyBrief(params: {
  scope: DailyBriefScope;
  window: DailyBriefWindow;
}) {
  const connection = await findConnection(params.scope.connectionId);

  if (!connection) {
    return null;
  }

  const run = await prisma.dailyBriefRun.findUnique({
    where: {
      jiraConnectionId_generatedForDate_windowStart_windowEnd_scopeType_scopeKey: {
        jiraConnectionId: params.scope.connectionId,
        generatedForDate: getStartOfDay(params.window.end, params.scope.timezone),
        windowStart: params.window.start,
        windowEnd: params.window.end,
        scopeType: params.scope.type as PrismaDailyBriefScopeType,
        scopeKey: params.scope.key,
      },
    },
    select: dailyBriefRunSelect,
  });

  if (!run) {
    return null;
  }

  return toDailyBriefView(
    run,
    toScopeFromPersistedRun(run, connection.timezone, connection.name),
  );
}

function buildIssueWhere(scope: DailyBriefScope): Prisma.IssueWhereInput {
  const baseWhere: Prisma.IssueWhereInput = {
    issueType: {
      not: "Epic",
    },
    project: {
      connection: {
        id: scope.connectionId,
      },
    },
  };

  if (scope.type === "PROJECT") {
    const parsed = splitScopeKey(scope.key);

    return {
      ...baseWhere,
      project: {
        connection: {
          id: scope.connectionId,
        },
        key: parsed?.entityKey,
      },
    };
  }

  if (scope.type === "PERSON") {
    const parsed = splitScopeKey(scope.key);

    return {
      ...baseWhere,
      assignee: {
        is: {
          jiraAccountId: parsed?.entityKey,
        },
      },
    };
  }

  return baseWhere;
}

async function persistDailyBrief(params: {
  scope: DailyBriefScope;
  window: DailyBriefWindow;
  syncRunId?: string | null;
  brief: DailyBriefView;
}) {
  const generatedForDate = getStartOfDay(params.window.end, params.scope.timezone);

  const persistedRun = await prisma.$transaction(async (tx) => {
    const existingRun = await tx.dailyBriefRun.findUnique({
      where: {
        jiraConnectionId_generatedForDate_windowStart_windowEnd_scopeType_scopeKey: {
          jiraConnectionId: params.scope.connectionId,
          generatedForDate,
          windowStart: params.window.start,
          windowEnd: params.window.end,
          scopeType: params.scope.type as PrismaDailyBriefScopeType,
          scopeKey: params.scope.key,
        },
      },
      select: {
        id: true,
      },
    });

    const run = existingRun
      ? await tx.dailyBriefRun.update({
          where: {
            id: existingRun.id,
          },
          data: {
            syncRunId: params.syncRunId ?? null,
            scopeLabel: params.scope.label,
            status: DailyBriefRunStatus.SUCCEEDED,
            summaryJson: toPrismaJson(params.brief.summary),
          },
          select: {
            id: true,
          },
        })
      : await tx.dailyBriefRun.create({
          data: {
            jiraConnectionId: params.scope.connectionId,
            syncRunId: params.syncRunId ?? null,
            generatedForDate,
            windowStart: params.window.start,
            windowEnd: params.window.end,
            scopeType: params.scope.type as PrismaDailyBriefScopeType,
            scopeKey: params.scope.key,
            scopeLabel: params.scope.label,
            status: DailyBriefRunStatus.SUCCEEDED,
            summaryJson: toPrismaJson(params.brief.summary),
          },
          select: {
            id: true,
          },
        });

    await tx.dailyBriefItem.deleteMany({
      where: {
        dailyBriefRunId: run.id,
      },
    });

    if (params.brief.items.length > 0) {
      await tx.dailyBriefItem.createMany({
        data: params.brief.items.map((item) => ({
          dailyBriefRunId: run.id,
          issueJiraId: item.issueJiraId,
          issueKey: item.issueKey,
          issueSummary: item.issueSummary,
          issueUrl: item.issueUrl,
          assigneeName: item.assigneeName,
          projectKey: item.projectKey,
          projectName: item.projectName,
          epicKey: item.epicKey,
          epicSummary: item.epicSummary,
          componentName: item.componentName,
          itemType: item.itemType as PrismaDailyBriefItemType,
          importance: item.importance as PrismaDailyBriefImportance,
          headline: item.headline,
          detailsJson: toPrismaJson(item.details),
        })),
      });
    }

    return tx.dailyBriefRun.findUniqueOrThrow({
      where: {
        id: run.id,
      },
      select: dailyBriefRunSelect,
    });
  });

  return persistedRun;
}

export async function generateDailyBrief(
  params: DailyBriefGenerationInput,
): Promise<DailyBriefGenerationResult> {
  const connection = await findConnection(params.scope.connectionId);

  if (!connection) {
    throw new Error("Daily brief scope connection was not found.");
  }

  const issues = await prisma.issue.findMany({
    where: buildIssueWhere(params.scope),
    orderBy: [
      {
        key: "asc",
      },
    ],
    select: dailyBriefIssueSelect,
  });

  const viewItems = issues.flatMap((issue) =>
    deriveDailyBriefItemsForIssue(toIssueSnapshot(issue), params.window),
  );
  const brief = buildDailyBriefView({
    id: "pending",
    scope: {
      ...params.scope,
      timezone: connection.timezone,
      connectionName: connection.name,
    },
    window: params.window,
    status: "SUCCEEDED",
    items: viewItems,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const persistedRun = await persistDailyBrief({
    scope: {
      ...params.scope,
      timezone: connection.timezone,
      connectionName: connection.name,
    },
    window: params.window,
    syncRunId: params.syncRunId,
    brief,
  });

  return toDailyBriefView(
    persistedRun,
    {
      ...params.scope,
      timezone: connection.timezone,
      connectionName: connection.name,
    },
  );
}

async function loadDailyBriefHistory(scope: DailyBriefScope): Promise<DailyBriefHistoryEntry[]> {
  const runs = await prisma.dailyBriefRun.findMany({
    where: {
      jiraConnectionId: scope.connectionId,
      scopeType: scope.type as PrismaDailyBriefScopeType,
      scopeKey: scope.key,
    },
    orderBy: [
      {
        generatedForDate: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
    take: HISTORY_LIMIT,
    select: {
      id: true,
      createdAt: true,
      generatedForDate: true,
      scopeType: true,
      scopeKey: true,
      scopeLabel: true,
      summaryJson: true,
    },
  });

  return runs.map((run) => {
    const summary = readDailyBriefSummary(run.summaryJson);

    return {
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      generatedForDate: run.generatedForDate.toISOString(),
      scopeType: run.scopeType as DailyBriefScopeType,
      scopeKey: run.scopeKey,
      scopeLabel: run.scopeLabel,
      headline: summary?.headline ?? run.scopeLabel,
      counts:
        summary?.counts ?? {
          completedCount: 0,
          startedCount: 0,
          attentionCount: 0,
          ownershipChangesCount: 0,
          peopleCovered: 0,
        },
    };
  });
}

function filterBriefToActionable(brief: DailyBriefView | null, actionableOnly: boolean) {
  if (!brief || !actionableOnly) {
    return brief;
  }

  const filteredItems = brief.items.filter((item) => item.importance !== "LOW");

  return {
    ...brief,
    items: filteredItems,
    sections: buildSections(filteredItems),
  };
}

async function loadScopeOptions() {
  const [projects, people, latestSync] = await Promise.all([
    prisma.jiraProject.findMany({
      orderBy: [
        {
          connection: {
            name: "asc",
          },
        },
        {
          key: "asc",
        },
      ],
      select: dailyBriefProjectOptionSelect,
    }),
    prisma.assignee.findMany({
      where: {
        issues: {
          some: {
            issueType: {
              not: "Epic",
            },
          },
        },
      },
      orderBy: [
        {
          displayName: "asc",
        },
      ],
      select: dailyBriefPersonOptionSelect,
    }),
    prisma.syncRun.findFirst({
      where: {
        status: SyncStatus.SUCCEEDED,
      },
      orderBy: {
        finishedAt: "desc",
      },
      select: {
        status: true,
        issuesFetched: true,
        requestedJql: true,
        finishedAt: true,
        jiraConnectionId: true,
        connection: {
          select: {
            id: true,
            name: true,
            timezone: true,
          },
        },
      },
    }),
  ]);

  return {
    projects,
    people: people.filter(hasResolvedPersonConnection),
    latestSync,
  };
}

function resolveScopeFromInput(params: {
  scopeType: DailyBriefScopeType;
  project?: string;
  person?: string;
  projects: Awaited<ReturnType<typeof loadScopeOptions>>["projects"];
  people: Awaited<ReturnType<typeof loadScopeOptions>>["people"];
  latestSync: Awaited<ReturnType<typeof loadScopeOptions>>["latestSync"];
}) {
  if (params.scopeType === "PROJECT" && params.project) {
    const selectedProject = params.projects.find(
      (project) =>
        buildProjectScopeKey(project.connection.id, project.key) === params.project,
    );

    if (selectedProject) {
      return {
        type: "PROJECT",
        key: buildProjectScopeKey(selectedProject.connection.id, selectedProject.key),
        label: `${selectedProject.key} · ${selectedProject.name}`,
        connectionId: selectedProject.connection.id,
        connectionName: selectedProject.connection.name,
        timezone: selectedProject.connection.timezone,
      } satisfies DailyBriefScope;
    }
  }

  if (params.scopeType === "PERSON" && params.person) {
    const selectedPerson = params.people.find(
      (person) =>
        buildPersonScopeKey(person.connection.id, person.jiraAccountId) === params.person,
    );

    if (selectedPerson) {
      return {
        type: "PERSON",
        key: buildPersonScopeKey(
          selectedPerson.connection.id,
          selectedPerson.jiraAccountId,
        ),
        label: `${selectedPerson.displayName} (${selectedPerson.connection.name})`,
        connectionId: selectedPerson.connection.id,
        connectionName: selectedPerson.connection.name,
        timezone: selectedPerson.connection.timezone,
      } satisfies DailyBriefScope;
    }
  }

  const defaultConnection =
    params.latestSync?.connection ??
    params.projects[0]?.connection ??
    params.people[0]?.connection ??
    null;

  if (!defaultConnection) {
    return null;
  }

  return {
    type: "TEAM",
    key: buildTeamScopeKey(defaultConnection.id),
    label: `Team · ${defaultConnection.name}`,
    connectionId: defaultConnection.id,
    connectionName: defaultConnection.name,
    timezone: defaultConnection.timezone,
  } satisfies DailyBriefScope;
}

export async function loadDailyBriefDashboard(
  input: LoadDailyBriefDashboardInput = {},
): Promise<DailyBriefDashboard> {
  const scopeType = normalizeScopeType(input.scopeType);
  const actionableOnly = normalizeActionableOnly(input.actionableOnly);
  const options = await loadScopeOptions();
  const scope = resolveScopeFromInput({
    scopeType,
    project: input.project,
    person: input.person,
    projects: options.projects,
    people: options.people,
    latestSync: options.latestSync,
  });
  const window = scope
    ? resolveDailyBriefWindow({
        preset: input.preset,
        from: input.from,
        to: input.to,
        timezone: scope.timezone,
        now: input.now,
      })
    : null;

  let brief: DailyBriefView | null = null;

  if (scope && window) {
    brief =
      input.regenerate
        ? await generateDailyBrief({
            scope,
            window,
          })
        : await resolveExistingDailyBrief({
            scope,
            window,
          });

    if (!brief) {
      brief = await generateDailyBrief({
        scope,
        window,
      });
    }
  }

  const history = scope ? await loadDailyBriefHistory(scope) : [];

  return {
    brief: filterBriefToActionable(brief, actionableOnly),
    latestSync: options.latestSync
      ? {
          status: options.latestSync.status,
          issuesFetched: options.latestSync.issuesFetched,
          requestedJql: options.latestSync.requestedJql ?? "",
          finishedAt: options.latestSync.finishedAt?.toISOString() ?? null,
        }
      : null,
    scope,
    scopeOptions: {
      projects: options.projects.map((project) => ({
        key: buildProjectScopeKey(project.connection.id, project.key),
        label: `${project.key} · ${project.name} (${project.connection.name})`,
      })),
      people: options.people.map((person) => ({
        key: buildPersonScopeKey(person.connection.id, person.jiraAccountId),
        label: `${person.displayName} (${person.connection.name})`,
        color: person.color,
      })),
    },
    window,
    history,
    filters: {
      scopeType,
      project: input.project ?? "",
      person: input.person ?? "",
      preset: window?.preset ?? normalizeWindowPreset(input.preset),
      from: window?.startInput ?? input.from ?? "",
      to: window?.endInput ?? input.to ?? "",
      actionableOnly,
    },
  };
}

export async function loadDailyBriefForApi(params: {
  scopeType?: string;
  scopeKey?: string;
  project?: string;
  person?: string;
  preset?: string;
  from?: string;
  to?: string;
  regenerate?: boolean;
  actionableOnly?: boolean;
  now?: Date;
}) {
  const dashboard = await loadDailyBriefDashboard({
    scopeType: params.scopeType,
    project: params.project ?? (params.scopeType === "PROJECT" ? params.scopeKey : undefined),
    person: params.person ?? (params.scopeType === "PERSON" ? params.scopeKey : undefined),
    preset: params.preset,
    from: params.from,
    to: params.to,
    regenerate: params.regenerate,
    actionableOnly: params.actionableOnly,
    now: params.now,
  });

  return dashboard.brief;
}

export async function loadDailyBriefHistoryForApi(params: {
  scopeType?: string;
  project?: string;
  person?: string;
}) {
  const dashboard = await loadDailyBriefDashboard({
    scopeType: params.scopeType,
    project: params.project,
    person: params.person,
  });

  return dashboard.history;
}

export async function generateAutomatedDailyBriefsForConnection(params: {
  jiraConnectionId: string;
  syncRunId?: string | null;
  now?: Date;
}) {
  const connection = await findConnection(params.jiraConnectionId);

  if (!connection) {
    return [];
  }

  const [projects, people] = await Promise.all([
    prisma.jiraProject.findMany({
      where: {
        jiraConnectionId: params.jiraConnectionId,
      },
      orderBy: {
        key: "asc",
      },
      select: {
        key: true,
        name: true,
      },
    }),
    prisma.assignee.findMany({
      where: {
        jiraConnectionId: params.jiraConnectionId,
        issues: {
          some: {
            issueType: {
              not: "Epic",
            },
          },
        },
      },
      orderBy: {
        displayName: "asc",
      },
      select: {
        jiraAccountId: true,
        displayName: true,
      },
    }),
  ]);

  const window = resolveDailyBriefWindow({
    preset: "PREVIOUS_BUSINESS_DAY",
    timezone: connection.timezone,
    now: params.now,
  });
  const scopes: DailyBriefScope[] = [
    {
      type: "TEAM",
      key: buildTeamScopeKey(connection.id),
      label: `Team · ${connection.name}`,
      connectionId: connection.id,
      connectionName: connection.name,
      timezone: connection.timezone,
    },
    ...projects.map((project) => ({
      type: "PROJECT" as const,
      key: buildProjectScopeKey(connection.id, project.key),
      label: `${project.key} · ${project.name}`,
      connectionId: connection.id,
      connectionName: connection.name,
      timezone: connection.timezone,
    })),
    ...people.map((person) => ({
      type: "PERSON" as const,
      key: buildPersonScopeKey(connection.id, person.jiraAccountId),
      label: `${person.displayName} (${connection.name})`,
      connectionId: connection.id,
      connectionName: connection.name,
      timezone: connection.timezone,
    })),
  ];

  const generated: DailyBriefView[] = [];

  for (const scope of scopes) {
    generated.push(
      await generateDailyBrief({
        scope,
        window,
        syncRunId: params.syncRunId,
      }),
    );
  }

  return generated;
}
