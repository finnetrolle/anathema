import type { Prisma } from "@prisma/client";

import { DEFAULT_APP_LOCALE, type AppLocale } from "@/modules/i18n/config";
import { prisma } from "@/modules/db/prisma";
import {
  deriveTimelineFields,
  isDoneStatus,
  isInProgressStatus,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";
import { resolveWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  buildTimelineModel,
  getDefaultTimelineRange,
  normalizeDayWidth,
  resolveTimelineRange,
} from "@/modules/timeline/build-timeline";
import {
  buildIssueDateBounds,
  buildIssueScopeWhere,
  buildVisibleIssueWhere,
  resolveScopedConnectionIds,
  resolveTimelineTimezones,
} from "@/modules/timeline/load-dashboard-helpers";
import {
  normalizeTimelineTimezone,
  normalizeTimelineTimezones,
} from "@/modules/timeline/date-helpers";
import { describeRiskReason } from "@/modules/risk-radar/reasons";
import type {
  RiskLevel,
  RiskReasonCode,
  RiskReasonView,
} from "@/modules/risk-radar/types";
import type {
  TimelineEpic,
  TimelineMarkerKind,
  TimelinePullRequestStatus,
} from "@/modules/timeline/types";

type TimelineDashboard = {
  timeline: ReturnType<typeof buildTimelineModel> | null;
  latestSync:
    | {
        status: string;
        issuesFetched: number;
        requestedJql: string;
      }
    | null;
  errorMessage: string | null;
  hasAnyIssues: boolean;
  projectFilter: {
    options: Array<{
      id: string;
      label: string;
    }>;
    selectedProjectId: string | null;
  };
  rangeInputs: {
    from: string;
    to: string;
    dayWidth: string;
  };
};

const timelineIssueSelect = {
  id: true,
  key: true,
  summary: true,
  status: true,
  startedAt: true,
  dueAt: true,
  resolvedAt: true,
  markerAt: true,
  markerKind: true,
  jiraCreatedAt: true,
  rawPayload: true,
  epic: {
    select: {
      id: true,
      key: true,
      summary: true,
    },
  },
  assignee: {
    select: {
      displayName: true,
      color: true,
    },
  },
  project: {
    select: {
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

type PersistedTimelineIssue = Prisma.IssueGetPayload<{
  select: typeof timelineIssueSelect;
}>;

type DerivedPersistedTimelineIssue = PersistedTimelineIssue & {
  derivedTimeline: {
    startAt: Date | null;
    markerAt: Date | null;
    markerKind: TimelineMarkerKind;
    isCompleted: boolean;
    isMissingDueDate: boolean;
  };
};

const timelineRiskSnapshotSelect = {
  issueId: true,
  riskScore: true,
  riskLevel: true,
  reasons: {
    orderBy: {
      weight: "desc",
    },
    select: {
      reasonCode: true,
      weight: true,
      detailsJson: true,
    },
  },
} satisfies Prisma.RiskSnapshotSelect;

type TimelineRiskSnapshot = Prisma.RiskSnapshotGetPayload<{
  select: typeof timelineRiskSnapshotSelect;
}>;

type TimelineIssueRiskSummary = {
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  riskReasons: RiskReasonView[];
};

const EMPTY_TIMELINE_ISSUE_RISK: TimelineIssueRiskSummary = {
  riskScore: null,
  riskLevel: null,
  riskReasons: [],
};

const trackedProjectSelect = {
  id: true,
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

type TrackedProject = Prisma.JiraProjectGetPayload<{
  select: typeof trackedProjectSelect;
}>;

const timelineScopeProjectSelect = {
  id: true,
  connection: {
    select: {
      id: true,
      timezone: true,
    },
  },
} satisfies Prisma.JiraProjectSelect;

type RawPayloadUser = {
  displayName?: string | null;
};

type RawPayloadIssue = {
  fields?: {
    components?: Array<{
      name?: string | null;
    }> | null;
    creator?: RawPayloadUser | null;
    reporter?: RawPayloadUser | null;
    assignee?: RawPayloadUser | null;
    status?: {
      statusCategory?: {
        key?: string | null;
      } | null;
    } | null;
    timeoriginalestimate?: number | string | null;
    aggregatetimeoriginalestimate?: number | string | null;
  } & Record<string, unknown>;
  changelog?: {
    histories?: Array<{
      id?: string;
      created?: string;
      items?: Array<{
        field?: string;
        fromString?: string | null;
        toString?: string | null;
      }>;
    }> | null;
  };
  __anathemaMeta?: {
    storyPointFieldIds?: string[] | null;
    developmentFieldIds?: string[] | null;
  };
};

type DerivedDevelopmentSummary = {
  pullRequestStatus: TimelinePullRequestStatus;
  pullRequestCount: number;
  commitCount: number;
};

const EMPTY_DEVELOPMENT_SUMMARY: DerivedDevelopmentSummary = {
  pullRequestStatus: "NONE",
  pullRequestCount: 0,
  commitCount: 0,
};

function getTimelinePlaceholderCopy(locale: AppLocale) {
  return {
    noComponent: locale === "ru" ? "Без компонента" : "No component",
    unassigned: locale === "ru" ? "Не назначен" : "Unassigned",
    ungroupedWork: locale === "ru" ? "Работа без эпика" : "Ungrouped work",
  };
}

function buildIssueUrl(baseUrl: string | null | undefined, key: string) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

function splitComponentNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRawPayload(rawPayload: Prisma.JsonValue | null) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  return rawPayload as RawPayloadIssue;
}

function toRiskDetailsRecord(details: Prisma.JsonValue | null) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  return details as Record<string, unknown>;
}

function toTimelineIssueRiskSummary(
  snapshot: TimelineRiskSnapshot,
  locale: AppLocale,
): TimelineIssueRiskSummary {
  return {
    riskScore: snapshot.riskScore,
    riskLevel: snapshot.riskLevel as RiskLevel,
    riskReasons: snapshot.reasons.map((reason) =>
      describeRiskReason(
        locale,
        reason.reasonCode as RiskReasonCode,
        reason.weight,
        toRiskDetailsRecord(reason.detailsJson),
      ),
    ),
  };
}

async function loadCurrentIssueRiskMap(params: {
  issueIds: string[];
  connectionIds: string[];
  locale: AppLocale;
}) {
  const { issueIds, connectionIds, locale } = params;

  if (issueIds.length === 0 || connectionIds.length === 0) {
    return new Map<string, TimelineIssueRiskSummary>();
  }

  const latestBatches = await prisma.riskSnapshot.groupBy({
    by: ["jiraConnectionId"],
    where: {
      jiraConnectionId: {
        in: connectionIds,
      },
    },
    _max: {
      computedAt: true,
    },
  });
  const currentBatchFilters = latestBatches.flatMap((batch) =>
    batch._max.computedAt
      ? [
          {
            jiraConnectionId: batch.jiraConnectionId,
            computedAt: batch._max.computedAt,
          },
        ]
      : [],
  );

  if (currentBatchFilters.length === 0) {
    return new Map<string, TimelineIssueRiskSummary>();
  }

  const snapshots = await prisma.riskSnapshot.findMany({
    where: {
      entityType: "ISSUE",
      issueId: {
        in: issueIds,
      },
      OR: currentBatchFilters,
    },
    select: timelineRiskSnapshotSelect,
  });

  return new Map(
    snapshots.flatMap((snapshot) =>
      snapshot.issueId
        ? [[snapshot.issueId, toTimelineIssueRiskSummary(snapshot, locale)]]
        : [],
    ),
  );
}

function deriveComponentName(
  rawPayload: Prisma.JsonValue | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const copy = getTimelinePlaceholderCopy(locale);
  const payload = readRawPayload(rawPayload);

  if (!payload) {
    return copy.noComponent;
  }

  const fieldComponents =
    payload.fields?.components
      ?.map((component) => component.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? [];

  if (fieldComponents.length > 0) {
    return fieldComponents.join(", ");
  }

  const componentHistories =
    payload.changelog?.histories
      ?.filter((history) =>
        history.items?.some(
          (item) => item.field === "Component" || item.field === "components",
        ),
      )
      .sort((left, right) => (left.created ?? "").localeCompare(right.created ?? "")) ?? [];

  const latestHistory = componentHistories.at(-1);
  const latestComponentValue = latestHistory?.items
    ?.filter((item) => item.field === "Component" || item.field === "components")
    .map((item) => item.toString?.trim() ?? "")
    .find((value) => value.length > 0);

  if (latestComponentValue) {
    const names = splitComponentNames(latestComponentValue);

    return names.length > 0 ? names.join(", ") : copy.noComponent;
  }

  return copy.noComponent;
}

function sortChangelogHistories(payload: RawPayloadIssue | null) {
  return [...(payload?.changelog?.histories ?? [])].sort((left, right) =>
    (left.created ?? "").localeCompare(right.created ?? ""),
  );
}

function readNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const embeddedJson = extractEmbeddedJsonValue(value);

    if (!embeddedJson) {
      return null;
    }

    try {
      return JSON.parse(embeddedJson) as unknown;
    } catch {
      return null;
    }
  }
}

function extractEmbeddedJsonValue(value: string) {
  const markerIndex = value.indexOf("devSummaryJson=");

  if (markerIndex < 0) {
    return null;
  }

  const jsonStart = value.indexOf("{", markerIndex);

  if (jsonStart < 0) {
    return null;
  }

  let depth = 0;
  let isInsideString = false;
  let isEscaped = false;

  for (let index = jsonStart; index < value.length; index += 1) {
    const character = value[index];

    if (!character) {
      continue;
    }

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === "\"") {
        isInsideString = false;
      }

      continue;
    }

    if (character === "\"") {
      isInsideString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(jsonStart, index + 1);
      }
    }
  }

  return null;
}

function readCountLike(value: unknown) {
  const numericValue = readNumericValue(value);

  if (numericValue !== null) {
    return numericValue;
  }

  return Array.isArray(value) ? value.length : null;
}

function normalizePullRequestStatus(
  value: unknown,
): Exclude<TimelinePullRequestStatus, "NONE"> | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "OPEN" || normalized === "MERGED" || normalized === "DECLINED") {
    return normalized;
  }

  return null;
}

function derivePullRequestStatusFromCounters(record: Record<string, unknown>) {
  const openCount = readCountLike(record.open) ?? 0;
  const mergedCount = readCountLike(record.merged) ?? 0;
  const declinedCount = readCountLike(record.declined) ?? 0;

  if (openCount > 0) {
    return "OPEN" satisfies TimelinePullRequestStatus;
  }

  if (mergedCount > 0) {
    return "MERGED" satisfies TimelinePullRequestStatus;
  }

  if (declinedCount > 0) {
    return "DECLINED" satisfies TimelinePullRequestStatus;
  }

  return "NONE" satisfies TimelinePullRequestStatus;
}

function derivePullRequestCount(record: Record<string, unknown>) {
  return (
    readCountLike(record.count) ??
    readCountLike(record.total) ??
    readCountLike(record.stateCount) ??
    readCountLike(toRecord(record.details)?.total) ??
    (readCountLike(record.open) ?? 0) +
      (readCountLike(record.merged) ?? 0) +
      (readCountLike(record.declined) ?? 0) +
      (readCountLike(toRecord(record.details)?.openCount) ?? 0) +
      (readCountLike(toRecord(record.details)?.mergedCount) ?? 0) +
      (readCountLike(toRecord(record.details)?.declinedCount) ?? 0)
  );
}

function mergePullRequestStatus(
  current: TimelinePullRequestStatus,
  next: TimelinePullRequestStatus,
) {
  if (current === "OPEN" || next === "OPEN") {
    return "OPEN" satisfies TimelinePullRequestStatus;
  }

  if (current === "MERGED" || next === "MERGED") {
    return "MERGED" satisfies TimelinePullRequestStatus;
  }

  if (current === "DECLINED" || next === "DECLINED") {
    return "DECLINED" satisfies TimelinePullRequestStatus;
  }

  return "NONE" satisfies TimelinePullRequestStatus;
}

function hasDevelopmentSummary(summary: DerivedDevelopmentSummary) {
  return summary.pullRequestCount > 0 || summary.commitCount > 0;
}

function mergeDevelopmentSummaries(
  current: DerivedDevelopmentSummary,
  next: DerivedDevelopmentSummary | null,
): DerivedDevelopmentSummary {
  if (!next) {
    return current;
  }

  return {
    pullRequestStatus: mergePullRequestStatus(
      current.pullRequestStatus,
      next.pullRequestStatus,
    ),
    pullRequestCount: Math.max(current.pullRequestCount, next.pullRequestCount),
    commitCount: Math.max(current.commitCount, next.commitCount),
  };
}

function readSummaryNode(value: unknown): DerivedDevelopmentSummary | null {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const pullRequestNode =
    toRecord(record.pullrequest) ??
    toRecord(record.pullRequest) ??
    toRecord(toRecord(record.summary)?.pullrequest) ??
    toRecord(toRecord(record.summary)?.pullRequest);
  const pullRequestOverall =
    toRecord(pullRequestNode?.overall) ?? pullRequestNode;
  const commitNode =
    toRecord(record.commit) ??
    toRecord(record.commits) ??
    toRecord(record.repository) ??
    toRecord(toRecord(record.summary)?.commit) ??
    toRecord(toRecord(record.summary)?.commits) ??
    toRecord(toRecord(record.summary)?.repository);
  const commitOverall = toRecord(commitNode?.overall) ?? commitNode;

  let pullRequestStatus: TimelinePullRequestStatus = "NONE";
  let pullRequestCount = 0;
  let commitCount = 0;

  if (pullRequestOverall) {
    const derivedCount = derivePullRequestCount(pullRequestOverall);

    pullRequestCount = derivedCount;
    pullRequestStatus =
      derivedCount > 0
        ? normalizePullRequestStatus(pullRequestOverall.state) ??
          derivePullRequestStatusFromCounters(pullRequestOverall)
        : "NONE";
  }

  if (commitOverall) {
    commitCount =
      readCountLike(commitOverall.count) ??
      readCountLike(commitOverall.commits) ??
      0;
  }

  const summary = {
    pullRequestStatus,
    pullRequestCount,
    commitCount,
  } satisfies DerivedDevelopmentSummary;

  return hasDevelopmentSummary(summary) ? summary : null;
}

function readTargetsSummary(value: unknown): DerivedDevelopmentSummary | null {
  const record = toRecord(value);
  const targets =
    toRecord(record?.targets) ?? toRecord(toRecord(record?.value)?.targets);

  if (!targets) {
    return null;
  }

  let pullRequestStatus: TimelinePullRequestStatus = "NONE";
  let pullRequestCount = 0;
  let commitCount = 0;

  for (const targetValue of Object.values(targets)) {
    if (!Array.isArray(targetValue)) {
      continue;
    }

    for (const entry of targetValue) {
      const entryRecord = toRecord(entry);
      const typeId = toRecord(entryRecord?.type)?.id;
      const objects = Array.isArray(entryRecord?.objects) ? entryRecord.objects : [];

      if (typeId === "pullrequest") {
        let countedPullRequests = 0;

        for (const objectValue of objects) {
          const objectRecord = toRecord(objectValue);

          if (!objectRecord) {
            continue;
          }

          const objectCount = readCountLike(objectRecord.count) ?? 1;
          const objectStatus =
            normalizePullRequestStatus(objectRecord.state) ??
            derivePullRequestStatusFromCounters(objectRecord);

          countedPullRequests += objectCount;
          pullRequestStatus = mergePullRequestStatus(
            pullRequestStatus,
            objectStatus,
          );
        }

        pullRequestCount +=
          countedPullRequests > 0
            ? countedPullRequests
            : readCountLike(entryRecord?.count) ?? 0;
      }

      if (typeId === "repository" || typeId === "commit") {
        let countedCommits = 0;

        for (const objectValue of objects) {
          const objectRecord = toRecord(objectValue);

          if (!objectRecord) {
            continue;
          }

          countedCommits +=
            readCountLike(objectRecord.count) ??
            readCountLike(objectRecord.commits) ??
            0;
        }

        commitCount +=
          countedCommits > 0 ? countedCommits : readCountLike(entryRecord?.count) ?? 0;
      }
    }
  }

  const summary = {
    pullRequestStatus,
    pullRequestCount,
    commitCount,
  } satisfies DerivedDevelopmentSummary;

  return hasDevelopmentSummary(summary) ? summary : null;
}

function looksLikeDevelopmentFieldValue(value: unknown) {
  if (typeof value === "string") {
    return /pullrequest|commit|cachedValue|targets|summary/i.test(value);
  }

  const record = toRecord(value);

  if (!record) {
    return false;
  }

  return [
    "json",
    "cachedValue",
    "summary",
    "value",
    "targets",
    "pullrequest",
    "pullRequest",
    "commit",
    "repository",
  ].some((key) => key in record);
}

function readDevelopmentFieldValue(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const fields = toRecord(payload?.fields);
  const configuredFieldIds = payload?.__anathemaMeta?.developmentFieldIds ?? [];

  if (!fields) {
    return null;
  }

  for (const fieldId of configuredFieldIds) {
    const value = fields[fieldId];

    if (value !== null && value !== undefined) {
      return value;
    }
  }

  for (const [fieldId, value] of Object.entries(fields)) {
    if (!fieldId.startsWith("customfield_") || !looksLikeDevelopmentFieldValue(value)) {
      continue;
    }

    return value;
  }

  return null;
}

function deriveDevelopmentSummary(
  rawPayload: Prisma.JsonValue | null,
): DerivedDevelopmentSummary {
  const rootValue = readDevelopmentFieldValue(rawPayload);

  if (!rootValue) {
    return EMPTY_DEVELOPMENT_SUMMARY;
  }

  const queue: unknown[] = [rootValue];
  const visitedObjects = new Set<object>();
  let summary = EMPTY_DEVELOPMENT_SUMMARY;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    if (typeof current === "string") {
      const parsed = parseJsonValue(current);

      if (parsed !== null) {
        queue.push(parsed);
      }

      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    if (visitedObjects.has(current)) {
      continue;
    }

    visitedObjects.add(current);
    const record = toRecord(current);

    if (!record) {
      continue;
    }

    summary = mergeDevelopmentSummaries(summary, readSummaryNode(record));
    summary = mergeDevelopmentSummaries(summary, readTargetsSummary(record));

    for (const key of [
      "json",
      "cachedValue",
      "summary",
      "value",
      "detail",
      "devSummary",
      "development",
      "pullrequest",
      "pullRequest",
      "commit",
      "repository",
    ]) {
      if (key in record) {
        queue.push(record[key]);
      }
    }
  }

  return summary;
}

function deriveAuthorName(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return (
    payload?.fields?.creator?.displayName?.trim() ||
    payload?.fields?.reporter?.displayName?.trim() ||
    null
  );
}

function deriveStatusCategoryKey(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return payload?.fields?.status?.statusCategory?.key ?? null;
}

function parseDerivedDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildIssueForTimelineDerivation(
  issue: PersistedTimelineIssue,
): JiraIssue | null {
  const payload = readRawPayload(issue.rawPayload);

  if (!payload?.fields) {
    return null;
  }

  const histories: NonNullable<JiraIssue["changelog"]>["histories"] = [];

  for (const [historyIndex, history] of (payload.changelog?.histories ?? []).entries()) {
    if (typeof history.created !== "string") {
      continue;
    }

    const items =
      history.items
        ?.filter(
          (
            item,
          ): item is {
            field: string;
            fromString?: string | null;
            toString?: string | null;
          } => typeof item.field === "string",
        )
        .map((item) => ({
          field: item.field,
          fromString: item.fromString ?? null,
          toString: item.toString ?? null,
        })) ?? [];

    histories.push({
      id: history.id ?? `${issue.key}:history:${historyIndex}`,
      created: history.created,
      items,
    });
  }

  return {
    id: issue.key,
    key: issue.key,
    fields: payload.fields as JiraIssue["fields"],
    changelog: {
      histories,
    },
  };
}

function deriveIssueTimelineState(
  issue: PersistedTimelineIssue,
  workflowRules: ReturnType<typeof resolveWorkflowRules>,
): DerivedPersistedTimelineIssue["derivedTimeline"] {
  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  const issueForDerivation = buildIssueForTimelineDerivation(issue);
  const derivedTimelineFields = issueForDerivation
    ? deriveTimelineFields(issueForDerivation, workflowRules)
    : null;
  const markerKind = derivedTimelineFields?.markerKind ?? issue.markerKind;

  return {
    startAt: derivedTimelineFields
      ? parseDerivedDate(derivedTimelineFields.startAt)
      : issue.startedAt,
    markerAt: derivedTimelineFields
      ? parseDerivedDate(derivedTimelineFields.markerAt)
      : issue.markerAt,
    markerKind,
    isCompleted: isDoneStatus(issue.status, workflowRules, statusCategoryKey),
    isMissingDueDate:
      markerKind === "NONE" &&
      isInProgressStatus(issue.status, workflowRules, statusCategoryKey),
  };
}

function deriveEstimateHours(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const estimateInSeconds =
    readNumericValue(payload?.fields?.timeoriginalestimate) ??
    readNumericValue(payload?.fields?.aggregatetimeoriginalestimate);

  return estimateInSeconds === null ? null : estimateInSeconds / 3600;
}

function deriveEstimateStoryPoints(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const storyPointFieldIds = payload?.__anathemaMeta?.storyPointFieldIds ?? [];

  for (const fieldId of storyPointFieldIds) {
    const storyPoints = readNumericValue(payload?.fields?.[fieldId]);

    if (storyPoints !== null) {
      return storyPoints;
    }
  }

  return null;
}

function deriveAssigneeHistory(
  rawPayload: Prisma.JsonValue | null,
  currentAssigneeName?: string | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const copy = getTimelinePlaceholderCopy(locale);
  const payload = readRawPayload(rawPayload);
  const assigneeNames: string[] = [];
  const seenNames = new Set<string>();

  const addAssignee = (value?: string | null) => {
    const normalized = value?.trim();

    if (
      !normalized ||
      normalized === "Unassigned" ||
      normalized === "Не назначен" ||
      normalized === copy.unassigned ||
      seenNames.has(normalized)
    ) {
      return;
    }

    seenNames.add(normalized);
    assigneeNames.push(normalized);
  };

  for (const history of sortChangelogHistories(payload)) {
    for (const item of history.items ?? []) {
      if (item.field?.toLowerCase() !== "assignee") {
        continue;
      }

      addAssignee(item.fromString);
      addAssignee(item.toString);
    }
  }

  addAssignee(currentAssigneeName);

  return assigneeNames;
}

function deriveObservedPeople(
  rawPayload: Prisma.JsonValue | null,
  currentAssigneeName?: string | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const payload = readRawPayload(rawPayload);
  const observedPeople: string[] = [];
  const seenPeople = new Set<string>();

  const addPerson = (value?: string | null) => {
    const normalized = value?.trim();

    if (!normalized || seenPeople.has(normalized)) {
      return;
    }

    seenPeople.add(normalized);
    observedPeople.push(normalized);
  };

  for (const assigneeName of deriveAssigneeHistory(
    rawPayload,
    currentAssigneeName,
    locale,
  )) {
    addPerson(assigneeName);
  }

  addPerson(currentAssigneeName);
  addPerson(payload?.fields?.creator?.displayName);
  addPerson(payload?.fields?.reporter?.displayName);

  return observedPeople;
}

function toTimelineEpics(
  issues: DerivedPersistedTimelineIssue[],
  locale: AppLocale = DEFAULT_APP_LOCALE,
  riskByIssueId = new Map<string, TimelineIssueRiskSummary>(),
): TimelineEpic[] {
  const copy = getTimelinePlaceholderCopy(locale);
  const groupedEpics = new Map<string, TimelineEpic>();

  for (const issue of issues) {
    const issueRisk = riskByIssueId.get(issue.id) ?? EMPTY_TIMELINE_ISSUE_RISK;
    const componentName = deriveComponentName(issue.rawPayload, locale);
    const assigneeName = issue.assignee?.displayName ?? copy.unassigned;
    const authorName = deriveAuthorName(issue.rawPayload);
    const assigneeHistory = deriveAssigneeHistory(issue.rawPayload, assigneeName, locale);
    const developmentSummary = deriveDevelopmentSummary(issue.rawPayload);
    const epicId = issue.epic?.id ?? "ungrouped";
    const groupKey = `${componentName}::${epicId}`;
    const existingEpic = groupedEpics.get(groupKey);
    const timelineIssue = {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      issueUrl: buildIssueUrl(issue.project.connection.baseUrl, issue.key),
      timezone: normalizeTimelineTimezone(issue.project.connection.timezone),
      componentName,
      epicId,
      epicKey: issue.epic?.key ?? "NO-EPIC",
      epicSummary: issue.epic?.summary ?? copy.ungroupedWork,
      assigneeName,
      assigneeColor: issue.assignee?.color ?? "#8ec5ff",
      status: issue.status,
      isCompleted: issue.derivedTimeline.isCompleted,
      createdAt: issue.jiraCreatedAt?.toISOString() ?? null,
      startAt: issue.derivedTimeline.startAt?.toISOString() ?? null,
      dueAt: issue.dueAt?.toISOString() ?? null,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      estimateHours: deriveEstimateHours(issue.rawPayload),
      estimateStoryPoints: deriveEstimateStoryPoints(issue.rawPayload),
      observedPeople: deriveObservedPeople(issue.rawPayload, assigneeName, locale),
      assigneeHistory,
      authorName,
      markerAt: issue.derivedTimeline.markerAt?.toISOString() ?? null,
      markerKind: issue.derivedTimeline.markerKind,
      pullRequestStatus: developmentSummary.pullRequestStatus,
      pullRequestCount: developmentSummary.pullRequestCount,
      commitCount: developmentSummary.commitCount,
      isMissingDueDate: issue.derivedTimeline.isMissingDueDate,
      riskScore: issueRisk.riskScore,
      riskLevel: issueRisk.riskLevel,
      riskReasons: issueRisk.riskReasons,
    } satisfies TimelineEpic["issues"][number];

    if (existingEpic) {
      existingEpic.issues.push(timelineIssue);
      continue;
    }

    groupedEpics.set(groupKey, {
      id: groupKey,
      componentName,
      key: issue.epic?.key ?? "NO-EPIC",
      summary: issue.epic?.summary ?? copy.ungroupedWork,
      issues: [timelineIssue],
    });
  }

  return [...groupedEpics.values()].sort((left, right) => {
    const componentCompare = left.componentName.localeCompare(right.componentName);

    if (componentCompare !== 0) {
      return componentCompare;
    }

    return left.key.localeCompare(right.key);
  });
}

type LoadTimelineDashboardInput = {
  from?: string;
  to?: string;
  dayWidth?: string;
  project?: string;
  locale?: AppLocale;
};

function normalizeDateInput(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function buildFallbackRangeInputs(
  from?: string,
  to?: string,
  dayWidth?: string,
  timezones?: string[] | null,
) {
  const normalizedFrom = normalizeDateInput(from);
  const normalizedTo = normalizeDateInput(to);
  const normalizedTimezones = normalizeTimelineTimezones(timezones ?? []);

  if (!normalizedFrom && !normalizedTo) {
    const defaultRange = getDefaultTimelineRange(new Date(), normalizedTimezones);

    return {
      from: defaultRange.startDayKey,
      to: defaultRange.endDayKey,
      dayWidth: String(normalizeDayWidth(dayWidth)),
    };
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    dayWidth: String(normalizeDayWidth(dayWidth)),
  };
}

function formatProjectLabel(project: TrackedProject) {
  const connectionName = project.connection.name.trim();
  const projectName = project.name.trim();

  if (!connectionName) {
    return `${project.key} · ${projectName}`;
  }

  return `${project.key} · ${projectName} (${connectionName})`;
}

export async function loadTimelineDashboard({
  from,
  to,
  dayWidth,
  project,
  locale = DEFAULT_APP_LOCALE,
}: LoadTimelineDashboardInput = {}): Promise<TimelineDashboard> {
  try {
    const trackedProjects = await prisma.jiraProject.findMany({
      select: trackedProjectSelect,
    });
    const projectFilterOptions = trackedProjects
      .map((trackedProject) => ({
        id: trackedProject.id,
        label: formatProjectLabel(trackedProject),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ru"));
    const selectedProjectId = projectFilterOptions.some(
      (option) => option.id === project,
    )
      ? project ?? null
      : null;
    const issueScopeWhere = buildIssueScopeWhere(selectedProjectId);
    const [issueSummary, scopedProjects] = await Promise.all([
      prisma.issue.aggregate({
        where: issueScopeWhere,
        _count: {
          id: true,
        },
        _min: {
          startedAt: true,
          dueAt: true,
          markerAt: true,
        },
        _max: {
          startedAt: true,
          dueAt: true,
          markerAt: true,
        },
      }),
      prisma.jiraProject.findMany({
        where: selectedProjectId
          ? {
              id: selectedProjectId,
            }
          : undefined,
        select: timelineScopeProjectSelect,
      }),
    ]);
    const timelineTimezones = resolveTimelineTimezones(scopedProjects);
    const scopedConnectionIds = resolveScopedConnectionIds(scopedProjects);
    const totalIssueCount = issueSummary._count.id;
    const resolvedRange = resolveTimelineRange(
      {
        timezones: timelineTimezones,
        rangeStart: from,
        rangeEnd: to,
        dayWidth,
      },
      buildIssueDateBounds(issueSummary),
    );
    const [latestSync, persistedVisibleIssues] = await Promise.all([
      scopedConnectionIds.length > 0
        ? prisma.syncRun.findFirst({
            where: {
              status: "SUCCEEDED",
              jiraConnectionId: {
                in: scopedConnectionIds,
              },
            },
            select: {
              status: true,
              issuesFetched: true,
              requestedJql: true,
            },
            orderBy: {
              startedAt: "desc",
            },
          })
        : null,
      totalIssueCount > 0
        ? prisma.issue.findMany({
            where: buildVisibleIssueWhere(
              issueScopeWhere,
              resolvedRange.visibleStart,
              resolvedRange.visibleEnd,
            ),
            select: timelineIssueSelect,
            orderBy: [
              {
                startedAt: "asc",
              },
              {
                markerAt: "asc",
              },
            ],
          })
        : [],
    ]);
    const workflowRulesByConnection = new Map<
      string,
      ReturnType<typeof resolveWorkflowRules>
    >();
    const visibleIssues = persistedVisibleIssues.map((issue) => {
      let workflowRules = workflowRulesByConnection.get(issue.project.connection.id);

      if (!workflowRules) {
        workflowRules = resolveWorkflowRules(issue.project.connection.workflowRules, {
          connectionId: issue.project.connection.id,
          connectionName: issue.project.connection.name,
        });
        workflowRulesByConnection.set(issue.project.connection.id, workflowRules);
      }

      return {
        ...issue,
        derivedTimeline: deriveIssueTimelineState(issue, workflowRules),
      } satisfies DerivedPersistedTimelineIssue;
    });
    const riskByIssueId = await loadCurrentIssueRiskMap({
      issueIds: visibleIssues.map((issue) => issue.id),
      connectionIds: scopedConnectionIds,
      locale,
    });
    const timeline =
      totalIssueCount > 0
        ? buildTimelineModel(toTimelineEpics(visibleIssues, locale, riskByIssueId), {
            locale,
            resolvedRange,
          })
        : null;

    return {
      timeline,
      latestSync: latestSync
        ? {
            status: latestSync.status,
            issuesFetched: latestSync.issuesFetched,
          requestedJql:
            latestSync.requestedJql ??
            (locale === "ru" ? "JQL по умолчанию" : "default JQL"),
        }
      : null,
      errorMessage: null,
      hasAnyIssues: totalIssueCount > 0,
      projectFilter: {
        options: projectFilterOptions,
        selectedProjectId,
      },
      rangeInputs: timeline
        ? {
            from: timeline.rangeStartInput,
            to: timeline.rangeEndInput,
            dayWidth: String(timeline.dayWidth),
          }
        : buildFallbackRangeInputs(from, to, dayWidth, timelineTimezones),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : locale === "ru"
          ? "Не удалось загрузить таймлайн из Prisma."
          : "Unable to load timeline from Prisma.";

    return {
      timeline: null,
      latestSync: null,
      errorMessage: message,
      hasAnyIssues: false,
      projectFilter: {
        options: [],
        selectedProjectId: null,
      },
      rangeInputs: buildFallbackRangeInputs(from, to, dayWidth),
    };
  }
}
