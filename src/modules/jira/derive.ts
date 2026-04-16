import type { JiraIssue } from "@/modules/jira/types";
import {
  getDefaultWorkflowRules,
  normalizeStatusCategoryKey,
  normalizeWorkflowStatusName,
  type JiraWorkflowRules,
} from "@/modules/jira/workflow-rules";
import {
  normalizeTimelineTimezone,
  parseDateOnlyAtHourInTimezone,
} from "@/modules/timeline/date-helpers";
import type {
  TimelineIssue,
  TimelineMarkerKind,
} from "@/modules/timeline/types";

const FALLBACK_ASSIGNEE_COLOR = "#8ec5ff";

const ASSIGNEE_COLORS = [
  "#83c8ff",
  "#d7f171",
  "#ff9f8c",
  "#a4f5c3",
  "#ffcf70",
  "#d4a5ff",
];

function hashAssigneeColor(input: string) {
  let hash = 0;

  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return ASSIGNEE_COLORS[hash % ASSIGNEE_COLORS.length] ?? FALLBACK_ASSIGNEE_COLOR;
}

export function deriveAssigneeIdentity(assignee?: {
  accountId?: string;
  key?: string;
  name?: string;
  displayName?: string;
} | null) {
  if (assignee?.accountId) {
    return `accountId:${assignee.accountId}`;
  }

  if (assignee?.key) {
    return `key:${assignee.key}`;
  }

  if (assignee?.name) {
    return `name:${assignee.name}`;
  }

  if (assignee?.displayName) {
    return `displayName:${assignee.displayName}`;
  }

  return null;
}

export function deriveAssigneeColor(assigneeIdentity?: string | null) {
  if (!assigneeIdentity) {
    return FALLBACK_ASSIGNEE_COLOR;
  }

  return hashAssigneeColor(assigneeIdentity);
}

function readStatusCategoryKey(status?: JiraIssue["fields"]["status"] | null) {
  return normalizeStatusCategoryKey(status?.statusCategory?.key);
}

export function isInProgressStatus(
  status?: string | null,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
  statusCategoryKey?: string | null,
) {
  const normalizedCategoryKey = normalizeStatusCategoryKey(statusCategoryKey);

  if (normalizedCategoryKey === "indeterminate") {
    return true;
  }

  if (normalizedCategoryKey === "done" || normalizedCategoryKey === "new") {
    return false;
  }

  const normalizedStatus = normalizeWorkflowStatusName(status);

  return normalizedStatus
    ? rules.inProgressStatusSet.has(normalizedStatus)
    : false;
}

export function isDoneStatus(
  status?: string | null,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
  statusCategoryKey?: string | null,
) {
  const normalizedCategoryKey = normalizeStatusCategoryKey(statusCategoryKey);

  if (normalizedCategoryKey === "done") {
    return true;
  }

  if (normalizedCategoryKey === "indeterminate" || normalizedCategoryKey === "new") {
    return false;
  }

  const normalizedStatus = normalizeWorkflowStatusName(status);

  return normalizedStatus ? rules.doneStatusSet.has(normalizedStatus) : false;
}

export function deriveStartedAt(
  issue: JiraIssue,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
) {
  const histories = issue.changelog?.histories ?? [];
  const sortedHistories = [...histories].sort((left, right) =>
    left.created.localeCompare(right.created),
  );

  for (const history of sortedHistories) {
    const movedIntoProgress = history.items.some(
      (item) =>
        item.field === "status" &&
        item.toString &&
        isInProgressStatus(item.toString, rules),
    );

    if (movedIntoProgress) {
      return history.created;
    }
  }

  return null;
}

function deriveDoneAt(
  issue: JiraIssue,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
) {
  const histories = issue.changelog?.histories ?? [];
  const sortedHistories = [...histories].sort((left, right) =>
    left.created.localeCompare(right.created),
  );
  let doneAt: string | null = null;

  for (const history of sortedHistories) {
    const movedIntoDone = history.items.some(
      (item) =>
        item.field === "status" &&
        item.toString &&
        isDoneStatus(item.toString, rules) &&
        !isDoneStatus(item.fromString, rules),
    );

    if (movedIntoDone) {
      doneAt = history.created;
    }
  }

  return doneAt;
}

export function deriveMarker(
  issue: JiraIssue,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
): {
  markerAt: string | null;
  markerKind: TimelineMarkerKind;
} {
  const statusCategoryKey = readStatusCategoryKey(issue.fields.status);

  if (issue.fields.resolutiondate) {
    return {
      markerAt: issue.fields.resolutiondate,
      markerKind: "DONE" as const,
    };
  }

  if (isDoneStatus(issue.fields.status?.name, rules, statusCategoryKey)) {
    return {
      // Prefer the real completion transition when possible. If we cannot infer
      // it, use the latest observed Jira timestamp so recently completed work
      // stays visible until workflow rules are configured more precisely.
      markerAt: deriveDoneAt(issue, rules) ?? issue.fields.updated ?? issue.fields.created ?? null,
      markerKind: "DONE" as const,
    };
  }

  if (issue.fields.duedate) {
    return {
      markerAt: `${issue.fields.duedate}T12:00:00.000Z`,
      markerKind: "DUE" as const,
    };
  }

  return {
    markerAt: issue.fields.updated ?? issue.fields.created ?? null,
    markerKind: "NONE" as const,
  };
}

export function deriveTimelineFields(
  issue: JiraIssue,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
) {
  const marker = deriveMarker(issue, rules);

  return {
    startAt: deriveStartedAt(issue, rules),
    markerAt: marker.markerAt,
    markerKind: marker.markerKind,
  };
}

export function deriveTimelineTask(
  issue: JiraIssue,
  rules: JiraWorkflowRules = getDefaultWorkflowRules(),
  timezone?: string | null,
): TimelineIssue {
  const assigneeName = issue.fields.assignee?.displayName ?? "Unassigned";
  const componentName =
    issue.fields.components
      ?.map((component) => component.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ") || "No component";
  const assigneeColor = deriveAssigneeColor(
    deriveAssigneeIdentity(issue.fields.assignee),
  );
  const statusCategoryKey = readStatusCategoryKey(issue.fields.status);
  const timelineFields = deriveTimelineFields(issue, rules);
  const observedPeople = Array.from(
    new Set(
      [
        assigneeName,
        issue.fields.creator?.displayName ?? null,
        issue.fields.reporter?.displayName ?? null,
      ].filter((personName): personName is string => Boolean(personName)),
    ),
  );

  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    issueUrl: null,
    timezone: normalizeTimelineTimezone(timezone),
    componentName,
    epicId: issue.fields.parent?.id ?? "ungrouped",
    epicKey: issue.fields.parent?.key ?? "NO-EPIC",
    epicSummary: issue.fields.parent?.fields?.summary ?? "Ungrouped work",
    assigneeName,
    assigneeColor,
    status: issue.fields.status?.name ?? "Unknown",
    isCompleted: isDoneStatus(
      issue.fields.status?.name,
      rules,
      statusCategoryKey,
    ),
    createdAt: issue.fields.created ?? null,
    startAt: timelineFields.startAt,
    dueAt: issue.fields.duedate
      ? parseDateOnlyAtHourInTimezone(
          issue.fields.duedate,
          normalizeTimelineTimezone(timezone),
          12,
        )?.toISOString() ?? null
      : null,
    resolvedAt: issue.fields.resolutiondate ?? null,
    estimateHours:
      typeof issue.fields.timeoriginalestimate === "number"
        ? issue.fields.timeoriginalestimate / 3600
        : typeof issue.fields.aggregatetimeoriginalestimate === "number"
          ? issue.fields.aggregatetimeoriginalestimate / 3600
          : null,
    estimateStoryPoints: null,
    observedPeople,
    assigneeHistory: assigneeName === "Unassigned" ? [] : [assigneeName],
    authorName:
      issue.fields.creator?.displayName ??
      issue.fields.reporter?.displayName ??
      null,
    markerAt: timelineFields.markerAt,
    markerKind: timelineFields.markerKind,
    pullRequestStatus: "NONE",
    pullRequestCount: 0,
    commitCount: 0,
    isMissingDueDate:
      timelineFields.markerKind === "NONE" &&
      isInProgressStatus(issue.fields.status?.name, rules, statusCategoryKey),
  };
}
