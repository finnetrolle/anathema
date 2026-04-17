import { describe, expect, it } from "vitest";

import {
  deriveDailyBriefItemsForIssue,
  type DailyBriefIssueSnapshot,
} from "@/modules/daily-brief/load-daily-brief";
import type { DailyBriefWindow } from "@/modules/daily-brief/types";

function buildWindow(): DailyBriefWindow {
  return {
    preset: "PREVIOUS_BUSINESS_DAY",
    start: new Date("2026-04-15T00:00:00.000Z"),
    end: new Date("2026-04-16T00:00:00.000Z"),
    label: "Since previous business day",
    startInput: "2026-04-15",
    endInput: "2026-04-16",
  };
}

function buildSnapshot(
  overrides: Partial<DailyBriefIssueSnapshot> = {},
): DailyBriefIssueSnapshot {
  return {
    issueJiraId: "jira-1",
    issueKey: "CORE-101",
    issueSummary: "Ship async standup brief",
    issueUrl: "https://jira.example/browse/CORE-101",
    assigneeAccountId: "acc-1",
    assigneeName: "Nina Sorokina",
    assigneeColor: "#83c8ff",
    projectKey: "CORE",
    projectName: "Core Platform",
    epicKey: "CORE-100",
    epicSummary: "Async rituals",
    componentName: "Backend",
    status: "In Progress",
    isCompleted: false,
    isInProgress: true,
    startAt: new Date("2026-04-14T09:00:00.000Z"),
    dueAt: new Date("2026-04-18T12:00:00.000Z"),
    resolvedAt: null,
    completedAt: null,
    jiraUpdatedAt: new Date("2026-04-15T11:00:00.000Z"),
    estimateHours: 8,
    estimateStoryPoints: 3,
    assigneeHistory: ["Nina Sorokina"],
    observedPeople: ["Nina Sorokina"],
    pullRequestStatus: "NONE",
    pullRequestCount: 0,
    commitCount: 0,
    statusTransitions: [],
    assigneeTransitions: [],
    ...overrides,
  };
}

describe("daily brief issue derivation", () => {
  it("emits completed and done-without-pr items for recently finished work", () => {
    const items = deriveDailyBriefItemsForIssue(
      buildSnapshot({
        status: "Done",
        isCompleted: true,
        isInProgress: false,
        resolvedAt: new Date("2026-04-15T10:00:00.000Z"),
        completedAt: new Date("2026-04-15T10:00:00.000Z"),
      }),
      buildWindow(),
    );

    expect(items.map((item) => item.itemType)).toEqual(
      expect.arrayContaining(["COMPLETED", "DONE_WITHOUT_PR"]),
    );
  });

  it("flags stale work and keeps no-code-activity deduped under stale", () => {
    const items = deriveDailyBriefItemsForIssue(
      buildSnapshot({
        dueAt: null,
        estimateHours: null,
        estimateStoryPoints: null,
      }),
      buildWindow(),
    );

    expect(items.map((item) => item.itemType)).toEqual(
      expect.arrayContaining([
        "STALE_IN_PROGRESS",
        "MISSING_DUE_DATE",
        "MISSING_ESTIMATE",
      ]),
    );
    expect(items.some((item) => item.itemType === "NO_CODE_ACTIVITY")).toBe(false);
  });

  it("captures reopened, ownership-changed, and overdue issues", () => {
    const items = deriveDailyBriefItemsForIssue(
      buildSnapshot({
        dueAt: new Date("2026-04-14T12:00:00.000Z"),
        commitCount: 2,
        statusTransitions: [
          {
            changedAt: new Date("2026-04-15T08:30:00.000Z"),
            fromStatus: "Done",
            toStatus: "In Progress",
          },
        ],
        assigneeTransitions: [
          {
            changedAt: new Date("2026-04-15T09:00:00.000Z"),
            fromAssigneeName: "Alex Kim",
            toAssigneeName: "Nina Sorokina",
          },
        ],
      }),
      buildWindow(),
    );

    expect(items.map((item) => item.itemType)).toEqual(
      expect.arrayContaining(["REOPENED", "OWNERSHIP_CHANGED", "OVERDUE"]),
    );
  });

  it("detects work that just started in the selected window", () => {
    const items = deriveDailyBriefItemsForIssue(
      buildSnapshot({
        startAt: new Date("2026-04-15T07:00:00.000Z"),
      }),
      buildWindow(),
    );

    expect(items.some((item) => item.itemType === "STARTED")).toBe(true);
  });
});
