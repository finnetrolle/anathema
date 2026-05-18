import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "@/modules/db/prisma";
import { isInProgressStatus, isDoneStatus } from "@/modules/jira/derive";
import { resolveWorkflowRules } from "@/modules/jira/workflow-rules";
import type { JiraWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  deriveDevelopmentSummary,
  hasDevelopmentSummary,
} from "@/modules/timeline/development-summary";
import {
  deriveAssigneeHistory,
  deriveEstimateHours,
  deriveEstimateStoryPoints,
  deriveStatusCategoryKey,
} from "@/modules/timeline/raw-payload-helpers";
import type { RiskLevel, RiskReasonCode } from "@/modules/timeline/risk-helpers";

// ── Types ──

export type RiskThresholds = {
  agingDaysWarning: number;
  agingDaysCritical: number;
  reassignmentsThreshold: number;
  staleDevActivityDays: number;
  epicHighRiskIssueCount: number;
};

export type DetectedReason = {
  reasonCode: RiskReasonCode;
  weight: number;
  detailsJson: Record<string, unknown>;
};

type RiskIssue = {
  id: string;
  jiraProjectId: string;
  epicId: string | null;
  key: string;
  status: string;
  dueAt: Date | null;
  resolvedAt: Date | null;
  startedAt: Date | null;
  rawPayload: Prisma.JsonValue | null;
  statusHistory: { fromStatus: string | null; toStatus: string }[];
};

export type DetectorContext = {
  issue: RiskIssue;
  now: DateTime;
  thresholds: RiskThresholds;
  workflowRules: JiraWorkflowRules;
};

export type DetectorFn = (ctx: DetectorContext) => DetectedReason | null;

// ── Score → Level ──

export function scoreToLevel(score: number): RiskLevel {
  if (score >= 8) return "CRITICAL";
  if (score >= 4) return "HIGH";
  if (score >= 1) return "MEDIUM";
  return "LOW";
}

// ── Detectors ──

export function detectOverdue(ctx: DetectorContext): DetectedReason | null {
  const { issue, now } = ctx;
  if (!issue.dueAt || issue.resolvedAt) return null;

  const due = DateTime.fromJSDate(issue.dueAt);
  const daysOverdue = Math.floor(now.diff(due, "days").days);
  if (daysOverdue <= 0) return null;

  return { reasonCode: "OVERDUE", weight: 3, detailsJson: { daysOverdue } };
}

export function detectAgingWip(ctx: DetectorContext): DetectedReason | null {
  const { issue, now, thresholds, workflowRules } = ctx;

  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  if (!isInProgressStatus(issue.status, workflowRules, statusCategoryKey)) return null;
  if (!issue.startedAt) return null;

  const started = DateTime.fromJSDate(issue.startedAt);
  const ageDays = Math.floor(now.diff(started, "days").days);

  if (ageDays >= thresholds.agingDaysCritical) {
    return { reasonCode: "AGING_WIP", weight: 4, detailsJson: { ageDays, severity: "CRITICAL" } };
  }
  if (ageDays >= thresholds.agingDaysWarning) {
    return { reasonCode: "AGING_WIP", weight: 2, detailsJson: { ageDays, severity: "WARNING" } };
  }
  return null;
}

export function detectMissingEstimate(ctx: DetectorContext): DetectedReason | null {
  const { issue } = ctx;
  const hours = deriveEstimateHours(issue.rawPayload);
  const sp = deriveEstimateStoryPoints(issue.rawPayload);
  if (hours === null && sp === null) {
    return { reasonCode: "MISSING_ESTIMATE", weight: 1, detailsJson: {} };
  }
  return null;
}

export function detectMissingDueDate(ctx: DetectorContext): DetectedReason | null {
  const { issue, workflowRules } = ctx;
  if (issue.dueAt) return null;
  if (issue.resolvedAt) return null;

  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  if (isDoneStatus(issue.status, workflowRules, statusCategoryKey)) return null;

  return { reasonCode: "MISSING_DUE_DATE", weight: 1, detailsJson: {} };
}

export function detectNoDevActivity(ctx: DetectorContext): DetectedReason | null {
  const { issue, now, thresholds, workflowRules } = ctx;

  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  if (!isInProgressStatus(issue.status, workflowRules, statusCategoryKey)) return null;
  if (!issue.startedAt) return null;

  const devSummary = deriveDevelopmentSummary(issue.rawPayload);
  if (hasDevelopmentSummary(devSummary)) return null;

  const started = DateTime.fromJSDate(issue.startedAt);
  const staleDays = Math.floor(now.diff(started, "days").days);
  if (staleDays < thresholds.staleDevActivityDays) return null;

  return { reasonCode: "NO_DEV_ACTIVITY", weight: 2, detailsJson: { staleDays } };
}

export function detectAssigneeChurn(ctx: DetectorContext): DetectedReason | null {
  const { issue, thresholds } = ctx;
  const history = deriveAssigneeHistory(issue.rawPayload);
  const reassignmentCount = Math.max(0, history.length - 1);
  if (reassignmentCount > thresholds.reassignmentsThreshold) {
    return { reasonCode: "ASSIGNEE_CHURN", weight: 2, detailsJson: { reassignmentCount } };
  }
  return null;
}

export function detectReopened(ctx: DetectorContext): DetectedReason | null {
  const { issue, workflowRules } = ctx;

  let reopenedCount = 0;
  for (const transition of issue.statusHistory) {
    if (
      transition.fromStatus !== null &&
      isDoneStatus(transition.fromStatus, workflowRules) &&
      !isDoneStatus(transition.toStatus, workflowRules)
    ) {
      reopenedCount++;
    }
  }

  if (reopenedCount > 0) {
    return { reasonCode: "REOPENED", weight: 2, detailsJson: { reopenedCount } };
  }
  return null;
}

// ── All detectors ──

export const ISSUE_DETECTORS: readonly DetectorFn[] = [
  detectOverdue,
  detectAgingWip,
  detectMissingEstimate,
  detectMissingDueDate,
  detectNoDevActivity,
  detectAssigneeChurn,
  detectReopened,
];

// ── Batch computation ──

export type ComputeRiskBatchInput = {
  jiraConnectionId: string;
  signal?: AbortSignal;
};

export async function computeRiskBatch({ jiraConnectionId, signal }: ComputeRiskBatchInput) {
  const connection = await prisma.jiraConnection.findUnique({
    where: { id: jiraConnectionId },
    select: { workflowRules: true },
  });
  if (!connection || signal?.aborted) return;

  const workflowRules = resolveWorkflowRules(connection.workflowRules, {
    connectionId: jiraConnectionId,
  });

  let thresholds = await prisma.riskThresholdConfig.findUnique({
    where: { jiraConnectionId },
  });
  if (!thresholds) {
    thresholds = await prisma.riskThresholdConfig.create({
      data: { jiraConnectionId },
    });
  }
  if (signal?.aborted) return;

  const issues = await prisma.issue.findMany({
    where: {
      project: { jiraConnectionId },
      issueType: { not: "Epic" },
    },
    select: {
      id: true,
      jiraProjectId: true,
      epicId: true,
      key: true,
      status: true,
      dueAt: true,
      resolvedAt: true,
      startedAt: true,
      rawPayload: true,
      statusHistory: {
        select: { fromStatus: true, toStatus: true },
        orderBy: { changedAt: "asc" },
      },
    },
  });
  if (signal?.aborted) return;

  const now = DateTime.now();
  const computedAt = now.toJSDate();
  const snapshotDate = now.startOf("day").toJSDate();

  await prisma.riskSnapshot.deleteMany({ where: { jiraConnectionId } });
  if (signal?.aborted) return;

  const t: RiskThresholds = {
    agingDaysWarning: thresholds.agingDaysWarning,
    agingDaysCritical: thresholds.agingDaysCritical,
    reassignmentsThreshold: thresholds.reassignmentsThreshold,
    staleDevActivityDays: thresholds.staleDevActivityDays,
    epicHighRiskIssueCount: thresholds.epicHighRiskIssueCount,
  };

  const snapshots: {
    data: Prisma.RiskSnapshotUncheckedCreateInput;
    reasons: { reasonCode: RiskReasonCode; weight: number; detailsJson: Record<string, unknown> }[];
  }[] = [];

  for (const issue of issues) {
    if (signal?.aborted) return;

    const ctx: DetectorContext = { issue, now, thresholds: t, workflowRules };
    const detected: DetectedReason[] = [];
    for (const detector of ISSUE_DETECTORS) {
      const result = detector(ctx);
      if (result) detected.push(result);
    }

    const riskScore = detected.reduce((sum, r) => sum + r.weight, 0);
    const riskLevel = scoreToLevel(riskScore);

    snapshots.push({
      data: {
        jiraConnectionId,
        jiraProjectId: issue.jiraProjectId,
        epicId: issue.epicId,
        issueId: issue.id,
        entityType: "ISSUE",
        entityKey: issue.key,
        riskScore,
        riskLevel,
        computedAt,
        snapshotDate,
      },
      reasons: detected,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const entry of snapshots) {
      const snapshot = await tx.riskSnapshot.create({ data: entry.data });
      if (entry.reasons.length > 0) {
        await tx.riskReason.createMany({
          data: entry.reasons.map((r) => ({
            riskSnapshotId: snapshot.id,
            reasonCode: r.reasonCode,
            weight: r.weight,
            detailsJson: r.detailsJson as Prisma.InputJsonValue,
          })),
        });
      }
    }
  });
}
