import type { Prisma } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import type { AppLocale } from "@/modules/i18n/config";
import {
  describeRiskReason,
  type RiskLevel,
  type RiskReasonCode,
  type RiskReasonView,
} from "@/modules/timeline/risk-helpers";
import type { TimelineMarkerKind } from "@/modules/timeline/types";

export const timelineIssueSelect = {
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

export type PersistedTimelineIssue = Prisma.IssueGetPayload<{
  select: typeof timelineIssueSelect;
}>;

export type DerivedPersistedTimelineIssue = PersistedTimelineIssue & {
  derivedTimeline: {
    startAt: Date | null;
    markerAt: Date | null;
    markerKind: TimelineMarkerKind;
    isCompleted: boolean;
    isMissingDueDate: boolean;
  };
};

export const timelineRiskSnapshotSelect = {
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

export type TimelineRiskSnapshot = Prisma.RiskSnapshotGetPayload<{
  select: typeof timelineRiskSnapshotSelect;
}>;

export type TimelineIssueRiskSummary = {
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  riskReasons: RiskReasonView[];
};

export const EMPTY_TIMELINE_ISSUE_RISK: TimelineIssueRiskSummary = {
  riskScore: null,
  riskLevel: null,
  riskReasons: [],
};

export const trackedProjectSelect = {
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

export type TrackedProject = Prisma.JiraProjectGetPayload<{
  select: typeof trackedProjectSelect;
}>;

export const timelineScopeProjectSelect = {
  id: true,
  connection: {
    select: {
      id: true,
      timezone: true,
    },
  },
} satisfies Prisma.JiraProjectSelect;

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

export async function loadCurrentIssueRiskMap(params: {
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
