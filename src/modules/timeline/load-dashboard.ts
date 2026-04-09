import type { Prisma } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import { isDoneStatus, isInProgressStatus } from "@/modules/jira/derive";
import {
  buildTimelineModel,
  getDefaultTimelineRange,
  normalizeDayWidth,
} from "@/modules/timeline/build-timeline";
import type {
  TimelineEpic,
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

type PersistedTimelineIssue = Prisma.IssueGetPayload<{
  include: {
    epic: true;
    assignee: true;
    project: {
      include: {
        connection: true;
      };
    };
  };
}>;

const NO_COMPONENT_LABEL = "No component";

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
    timeoriginalestimate?: number | string | null;
    aggregatetimeoriginalestimate?: number | string | null;
  } & Record<string, unknown>;
  changelog?: {
    histories?: Array<{
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

function deriveComponentName(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  if (!payload) {
    return NO_COMPONENT_LABEL;
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

    return names.length > 0 ? names.join(", ") : NO_COMPONENT_LABEL;
  }

  return NO_COMPONENT_LABEL;
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
) {
  const payload = readRawPayload(rawPayload);
  const assigneeNames: string[] = [];
  const seenNames = new Set<string>();

  const addAssignee = (value?: string | null) => {
    const normalized = value?.trim();

    if (!normalized || normalized === "Unassigned" || seenNames.has(normalized)) {
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

  for (const assigneeName of deriveAssigneeHistory(rawPayload, currentAssigneeName)) {
    addPerson(assigneeName);
  }

  addPerson(currentAssigneeName);
  addPerson(payload?.fields?.creator?.displayName);
  addPerson(payload?.fields?.reporter?.displayName);

  return observedPeople;
}

function toTimelineEpics(issues: PersistedTimelineIssue[]): TimelineEpic[] {
  const groupedEpics = new Map<string, TimelineEpic>();

  for (const issue of issues) {
    const componentName = deriveComponentName(issue.rawPayload);
    const assigneeName = issue.assignee?.displayName ?? "Unassigned";
    const authorName = deriveAuthorName(issue.rawPayload);
    const assigneeHistory = deriveAssigneeHistory(issue.rawPayload, assigneeName);
    const developmentSummary = deriveDevelopmentSummary(issue.rawPayload);
    const epicId = issue.epic?.id ?? "ungrouped";
    const groupKey = `${componentName}::${epicId}`;
    const existingEpic = groupedEpics.get(groupKey);
    const timelineIssue = {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      issueUrl: buildIssueUrl(issue.project.connection.baseUrl, issue.key),
      componentName,
      epicId,
      epicKey: issue.epic?.key ?? "NO-EPIC",
      epicSummary: issue.epic?.summary ?? "Ungrouped work",
      assigneeName,
      assigneeColor: issue.assignee?.color ?? "#8ec5ff",
      status: issue.status,
      isCompleted: isDoneStatus(issue.status),
      createdAt: issue.jiraCreatedAt?.toISOString() ?? null,
      startAt: issue.startedAt?.toISOString() ?? null,
      dueAt: issue.dueAt?.toISOString() ?? null,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      estimateHours: deriveEstimateHours(issue.rawPayload),
      estimateStoryPoints: deriveEstimateStoryPoints(issue.rawPayload),
      observedPeople: deriveObservedPeople(issue.rawPayload, assigneeName),
      assigneeHistory,
      authorName,
      markerAt: issue.markerAt?.toISOString() ?? null,
      markerKind: issue.markerKind,
      pullRequestStatus: developmentSummary.pullRequestStatus,
      pullRequestCount: developmentSummary.pullRequestCount,
      commitCount: developmentSummary.commitCount,
      isMissingDueDate:
        issue.markerKind === "NONE" && isInProgressStatus(issue.status),
    } satisfies TimelineEpic["issues"][number];

    if (existingEpic) {
      existingEpic.issues.push(timelineIssue);
      continue;
    }

    groupedEpics.set(groupKey, {
      id: groupKey,
      componentName,
      key: issue.epic?.key ?? "NO-EPIC",
      summary: issue.epic?.summary ?? "Ungrouped work",
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
};

function normalizeDateInput(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function buildFallbackRangeInputs(from?: string, to?: string, dayWidth?: string) {
  const normalizedFrom = normalizeDateInput(from);
  const normalizedTo = normalizeDateInput(to);

  if (!normalizedFrom && !normalizedTo) {
    const defaultRange = getDefaultTimelineRange();

    return {
      from: defaultRange.start.toISOString().slice(0, 10),
      to: defaultRange.end.toISOString().slice(0, 10),
      dayWidth: String(normalizeDayWidth(dayWidth)),
    };
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    dayWidth: String(normalizeDayWidth(dayWidth)),
  };
}

function formatProjectLabel(
  project: Prisma.JiraProjectGetPayload<{
    include: {
      connection: true;
    };
  }>,
) {
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
}: LoadTimelineDashboardInput = {}): Promise<TimelineDashboard> {
  try {
    const [latestSync, trackedProjects, totalIssueCount] = await Promise.all([
      prisma.syncRun.findFirst({
        orderBy: {
          startedAt: "desc",
        },
      }),
      prisma.jiraProject.findMany({
        include: {
          connection: true,
        },
      }),
      prisma.issue.count({
        where: {
          issueType: {
            not: "Epic",
          },
        },
      }),
    ]);
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
    const issues = await prisma.issue.findMany({
      where: {
        issueType: {
          not: "Epic",
        },
        ...(selectedProjectId ? { jiraProjectId: selectedProjectId } : {}),
      },
      include: {
        epic: true,
        assignee: true,
        project: {
          include: {
            connection: true,
          },
        },
      },
      orderBy: [
        {
          startedAt: "asc",
        },
        {
          markerAt: "asc",
        },
      ],
    });
    const timeline =
      totalIssueCount > 0
        ? buildTimelineModel(toTimelineEpics(issues), {
            rangeStart: from,
            rangeEnd: to,
            dayWidth,
          })
        : null;

    return {
      timeline,
      latestSync: latestSync
        ? {
            status: latestSync.status,
            issuesFetched: latestSync.issuesFetched,
            requestedJql: latestSync.requestedJql ?? "default JQL",
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
        : buildFallbackRangeInputs(from, to, dayWidth),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load timeline from Prisma.";

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
