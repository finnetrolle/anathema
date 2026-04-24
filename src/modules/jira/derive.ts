import type { JiraIssue } from "@/modules/jira/types";
import {
  getDefaultWorkflowRules,
  normalizeStatusCategoryKey,
  normalizeWorkflowStatusName,
  type JiraWorkflowRules,
} from "@/modules/jira/workflow-rules";
import type {
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

  return ASSIGNEE_COLORS[hash % ASSIGNEE_COLORS.length];
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


