import type { Prisma } from "@prisma/client";

import { DEFAULT_APP_LOCALE, type AppLocale } from "@/modules/i18n/config";
import type { TimelinePullRequestStatus } from "@/modules/timeline/types";

export type RawPayloadUser = {
  displayName?: string | null;
};

export type RawPayloadIssue = {
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

export type DerivedDevelopmentSummary = {
  pullRequestStatus: TimelinePullRequestStatus;
  pullRequestCount: number;
  commitCount: number;
};

export const EMPTY_DEVELOPMENT_SUMMARY: DerivedDevelopmentSummary = {
  pullRequestStatus: "NONE",
  pullRequestCount: 0,
  commitCount: 0,
};

export function getTimelinePlaceholderCopy(locale: AppLocale) {
  return {
    noComponent: locale === "ru" ? "Без компонента" : "No component",
    unassigned: locale === "ru" ? "Не назначен" : "Unassigned",
    ungroupedWork: locale === "ru" ? "Работа без эпика" : "Ungrouped work",
  };
}

export function buildIssueUrl(baseUrl: string | null | undefined, key: string) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

export function splitComponentNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readRawPayload(rawPayload: Prisma.JsonValue | null) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  return rawPayload as RawPayloadIssue;
}

export function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parseDerivedDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export function deriveDevelopmentSummary(
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

export function deriveAuthorName(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return (
    payload?.fields?.creator?.displayName?.trim() ||
    payload?.fields?.reporter?.displayName?.trim() ||
    null
  );
}

export function deriveStatusCategoryKey(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return payload?.fields?.status?.statusCategory?.key ?? null;
}

function sortChangelogHistories(payload: RawPayloadIssue | null) {
  return [...(payload?.changelog?.histories ?? [])].sort((left, right) =>
    (left.created ?? "").localeCompare(right.created ?? ""),
  );
}

export function deriveEstimateHours(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const estimateInSeconds =
    readNumericValue(payload?.fields?.timeoriginalestimate) ??
    readNumericValue(payload?.fields?.aggregatetimeoriginalestimate);

  return estimateInSeconds === null ? null : estimateInSeconds / 3600;
}

export function deriveEstimateStoryPoints(rawPayload: Prisma.JsonValue | null) {
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

export function deriveAssigneeHistory(
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

export function deriveObservedPeople(
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

export function deriveComponentName(
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
