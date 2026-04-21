import { describe, expect, it } from "vitest";

import {
  deriveIssueRiskSnapshot,
  deriveRiskLevel,
  type RiskSourceIssueSnapshot,
} from "@/modules/risk-radar/load-risk-radar";
import type { RiskThresholds } from "@/modules/risk-radar/types";

const thresholds: RiskThresholds = {
  agingDaysWarning: 5,
  agingDaysCritical: 10,
  reassignmentsThreshold: 2,
  staleDevActivityDays: 3,
  epicHighRiskIssueCount: 2,
};

function buildIssue(
  overrides: Partial<RiskSourceIssueSnapshot> = {},
): RiskSourceIssueSnapshot {
  return {
    connectionId: "conn-1",
    connectionName: "Smoke Jira",
    connectionBaseUrl: "https://jira.example",
    connectionTimezone: "Europe/Moscow",
    projectId: "project-1",
    projectKey: "CORE",
    projectName: "Core Platform",
    issueId: "issue-1",
    issueJiraId: "jira-1",
    issueKey: "CORE-101",
    issueSummary: "Ship delivery risk radar",
    issueUrl: "https://jira.example/browse/CORE-101",
    status: "In Progress",
    isCompleted: false,
    isInProgress: true,
    startAt: new Date("2026-04-01T09:00:00.000Z"),
    dueAt: new Date("2026-04-10T12:00:00.000Z"),
    resolvedAt: null,
    jiraUpdatedAt: new Date("2026-04-12T10:00:00.000Z"),
    epicId: "epic-1",
    epicKey: "CORE-100",
    epicSummary: "Delivery health",
    assigneeEntityKey: "acc-1",
    assigneeAccountId: "acc-1",
    assigneeName: "Nina Sorokina",
    componentName: "Backend",
    componentNames: ["Backend"],
    estimateHours: 8,
    estimateStoryPoints: 3,
    pullRequestCount: 1,
    commitCount: 2,
    statusTransitions: [],
    assigneeTransitions: [],
    reopenedCount: 0,
    latestReopenedAt: null,
    ...overrides,
  };
}

describe("risk radar issue scoring", () => {
  it("flags overdue aging work with churn, reopen, and no dev activity", () => {
    const issue = buildIssue({
      estimateHours: null,
      estimateStoryPoints: null,
      pullRequestCount: 0,
      commitCount: 0,
      assigneeTransitions: [
        {
          changedAt: new Date("2026-04-02T09:00:00.000Z"),
          fromAssigneeName: "Alex Kim",
          toAssigneeName: "Nina Sorokina",
        },
        {
          changedAt: new Date("2026-04-03T09:00:00.000Z"),
          fromAssigneeName: "Nina Sorokina",
          toAssigneeName: "Alex Kim",
        },
      ],
      reopenedCount: 1,
      latestReopenedAt: new Date("2026-04-12T09:00:00.000Z"),
    });

    const snapshot = deriveIssueRiskSnapshot(
      issue,
      thresholds,
      new Date("2026-04-17T10:00:00.000Z"),
    );

    expect(snapshot.reasons.map((reason) => reason.reasonCode)).toEqual(
      expect.arrayContaining([
        "OVERDUE",
        "AGING_WIP",
        "MISSING_ESTIMATE",
        "NO_DEV_ACTIVITY",
        "ASSIGNEE_CHURN",
        "REOPENED",
      ]),
    );
    expect(snapshot.riskScore).toBe(100);
    expect(snapshot.riskLevel).toBe("CRITICAL");
  });

  it("flags active work without due date or estimate", () => {
    const snapshot = deriveIssueRiskSnapshot(
      buildIssue({
        dueAt: null,
        estimateHours: null,
        estimateStoryPoints: null,
      }),
      thresholds,
      new Date("2026-04-17T10:00:00.000Z"),
    );

    expect(snapshot.reasons.map((reason) => reason.reasonCode)).toEqual(
      expect.arrayContaining(["MISSING_DUE_DATE", "MISSING_ESTIMATE"]),
    );
  });

  it("does not score completed work as current risk", () => {
    const snapshot = deriveIssueRiskSnapshot(
      buildIssue({
        isCompleted: true,
        isInProgress: false,
        status: "Done",
        resolvedAt: new Date("2026-04-11T10:00:00.000Z"),
        pullRequestCount: 0,
        commitCount: 0,
        reopenedCount: 2,
      }),
      thresholds,
      new Date("2026-04-17T10:00:00.000Z"),
    );

    expect(snapshot.reasons).toHaveLength(0);
    expect(snapshot.reasons.some((reason) => reason.reasonCode === "REOPENED")).toBe(false);
    expect(snapshot.riskLevel).toBe("LOW");
  });
});

describe("risk level normalization", () => {
  it("maps score bands into stable levels", () => {
    expect(deriveRiskLevel(0)).toBe("LOW");
    expect(deriveRiskLevel(24)).toBe("LOW");
    expect(deriveRiskLevel(25)).toBe("MEDIUM");
    expect(deriveRiskLevel(49)).toBe("MEDIUM");
    expect(deriveRiskLevel(50)).toBe("HIGH");
    expect(deriveRiskLevel(74)).toBe("HIGH");
    expect(deriveRiskLevel(75)).toBe("CRITICAL");
    expect(deriveRiskLevel(100)).toBe("CRITICAL");
  });
});
