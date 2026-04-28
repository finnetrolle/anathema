import {
  Prisma,
  TimelineMarkerKind as PrismaTimelineMarkerKind,
} from "@prisma/client";

import {
  deriveAssigneeColor,
  deriveAssigneeIdentity,
  deriveTimelineFields,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";
import type { JiraWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  normalizeTimelineTimezone,
  parseDateOnlyAtHourInTimezone,
} from "@/modules/timeline/date-helpers";
import type { TimelineMarkerKind } from "@/modules/timeline/types";

// ── Types ──

export type ProjectSeed = {
  jiraProjectId: string;
  key: string;
  name: string;
};

export type EpicSeed = {
  jiraEpicId: string;
  key: string;
  summary: string;
  status: string;
  jiraUpdatedAt: Date | null;
};

export type CollectedTransition = {
  jiraIssueId: string;
  jiraProjectId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date;
};

// ── Pure functions ──

export function readEpicLinkKey(issue: JiraIssue, epicLinkFieldId?: string) {
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

export function parseJiraDate(value?: string | null, timezone?: string | null) {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateOnlyAtHourInTimezone(
      value,
      normalizeTimelineTimezone(timezone),
      12,
    );
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toPrismaJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function buildRawPayload(
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

export function toPrismaMarkerKind(kind: TimelineMarkerKind) {
  switch (kind) {
    case "DONE":
      return PrismaTimelineMarkerKind.DONE;
    case "DUE":
      return PrismaTimelineMarkerKind.DUE;
    default:
      return PrismaTimelineMarkerKind.NONE;
  }
}

export function isEpicIssue(issue: JiraIssue) {
  return issue.fields.issuetype?.name?.toLowerCase() === "epic";
}

export function buildProjectSeed(issue: JiraIssue): ProjectSeed {
  const inferredKey = issue.key.split("-")[0] ?? "UNKNOWN";

  return {
    jiraProjectId: issue.fields.project?.id ?? inferredKey,
    key: issue.fields.project?.key ?? inferredKey,
    name: issue.fields.project?.name ?? inferredKey,
  };
}

export function buildEpicSeed(issue: JiraIssue): EpicSeed | null {
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

export function buildEpicLookup(issues: JiraIssue[]) {
  const epicLookup = new Map<string, JiraIssue>();

  for (const issue of issues) {
    if (isEpicIssue(issue)) {
      epicLookup.set(issue.id, issue);
      epicLookup.set(issue.key, issue);
    }
  }

  return epicLookup;
}

export function buildLinkedEpicSeed(params: {
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

export function isPlaceholderEpicId(jiraEpicId: string, key: string) {
  return jiraEpicId === key;
}

export function isPlaceholderEpicSummary(summary: string, key: string) {
  const normalizedSummary = summary.trim();

  return normalizedSummary.length === 0 || normalizedSummary === key;
}

export function mergeEpicSeeds(existing: EpicSeed, incoming: EpicSeed): EpicSeed {
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

export function collectEntities(
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
