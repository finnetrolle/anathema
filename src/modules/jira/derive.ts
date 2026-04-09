import type { JiraIssue } from "@/modules/jira/types";
import type {
  TimelineIssue,
  TimelineMarkerKind,
} from "@/modules/timeline/types";

const IN_PROGRESS_STATUSES = new Set([
  "In Progress",
  "Development",
  "Coding",
  "Code Review",
  "In QA",
  "QA",
]);
const DONE_STATUSES = new Set([
  "Done",
  "Closed",
  "Resolved",
  "Completed",
]);

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
  return (
    assignee?.accountId ??
    assignee?.key ??
    assignee?.name ??
    assignee?.displayName ??
    null
  );
}

export function deriveAssigneeColor(assigneeIdentity?: string | null) {
  if (!assigneeIdentity) {
    return FALLBACK_ASSIGNEE_COLOR;
  }

  return hashAssigneeColor(assigneeIdentity);
}

export function isInProgressStatus(status?: string | null) {
  return status ? IN_PROGRESS_STATUSES.has(status) : false;
}

export function isDoneStatus(status?: string | null) {
  return status ? DONE_STATUSES.has(status) : false;
}

export function deriveStartedAt(issue: JiraIssue) {
  const histories = issue.changelog?.histories ?? [];
  const sortedHistories = [...histories].sort((left, right) =>
    left.created.localeCompare(right.created),
  );

  for (const history of sortedHistories) {
    const movedIntoProgress = history.items.some(
      (item) =>
        item.field === "status" &&
        item.toString &&
        isInProgressStatus(item.toString),
    );

    if (movedIntoProgress) {
      return history.created;
    }
  }

  return null;
}

export function deriveMarker(issue: JiraIssue): {
  markerAt: string | null;
  markerKind: TimelineMarkerKind;
} {
  if (issue.fields.resolutiondate) {
    return {
      markerAt: issue.fields.resolutiondate,
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

export function deriveTimelineFields(issue: JiraIssue) {
  const marker = deriveMarker(issue);

  return {
    startAt: deriveStartedAt(issue),
    markerAt: marker.markerAt,
    markerKind: marker.markerKind,
  };
}

export function deriveTimelineTask(issue: JiraIssue): TimelineIssue {
  const assigneeName = issue.fields.assignee?.displayName ?? "Unassigned";
  const componentName =
    issue.fields.components
      ?.map((component) => component.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ") || "No component";
  const assigneeColor = deriveAssigneeColor(
    deriveAssigneeIdentity(issue.fields.assignee),
  );
  const timelineFields = deriveTimelineFields(issue);
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
    componentName,
    epicId: issue.fields.parent?.id ?? "ungrouped",
    epicKey: issue.fields.parent?.key ?? "NO-EPIC",
    epicSummary: issue.fields.parent?.fields?.summary ?? "Ungrouped work",
    assigneeName,
    assigneeColor,
    status: issue.fields.status?.name ?? "Unknown",
    isCompleted: isDoneStatus(issue.fields.status?.name),
    createdAt: issue.fields.created ?? null,
    startAt: timelineFields.startAt,
    dueAt: issue.fields.duedate
      ? `${issue.fields.duedate}T12:00:00.000Z`
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
      isInProgressStatus(issue.fields.status?.name),
  };
}
