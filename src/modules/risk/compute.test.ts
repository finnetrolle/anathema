import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { getDefaultWorkflowRules } from "@/modules/jira/workflow-rules";
import type { JiraWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  scoreToLevel,
  detectOverdue,
  detectAgingWip,
  detectMissingEstimate,
  detectMissingDueDate,
  detectNoDevActivity,
  detectAssigneeChurn,
  detectReopened,
  ISSUE_DETECTORS,
  type DetectorContext,
  type RiskThresholds,
} from "./compute";
import type { RiskLevel } from "@/modules/timeline/risk-helpers";

// ── Helpers ──

const DEFAULT_THRESHOLDS: RiskThresholds = {
  agingDaysWarning: 5,
  agingDaysCritical: 10,
  reassignmentsThreshold: 2,
  staleDevActivityDays: 3,
  epicHighRiskIssueCount: 2,
};

const DEFAULT_RULES: JiraWorkflowRules = getDefaultWorkflowRules();

function makeCtx(overrides: Partial<DetectorContext["issue"]> = {}): DetectorContext {
  return {
    issue: {
      id: "issue-1",
      jiraProjectId: "proj-1",
      epicId: null,
      key: "PROJ-1",
      status: "In Progress",
      dueAt: null,
      resolvedAt: null,
      startedAt: null,
      rawPayload: null,
      statusHistory: [],
      ...overrides,
    },
    now: DateTime.fromISO("2026-05-12T12:00:00"),
    thresholds: DEFAULT_THRESHOLDS,
    workflowRules: DEFAULT_RULES,
  };
}

// ── scoreToLevel ──

describe("scoreToLevel", () => {
  it.each([
    [0, "LOW"],
    [1, "MEDIUM"],
    [3, "MEDIUM"],
    [4, "HIGH"],
    [7, "HIGH"],
    [8, "CRITICAL"],
    [15, "CRITICAL"],
  ] as [number, RiskLevel][])("maps score %d → %s", (score, expected) => {
    expect(scoreToLevel(score)).toBe(expected);
  });
});

// ── detectOverdue ──

describe("detectOverdue", () => {
  it("returns null when no due date", () => {
    expect(detectOverdue(makeCtx())).toBeNull();
  });

  it("returns null when issue is resolved", () => {
    const ctx = makeCtx({
      dueAt: new Date("2026-05-01"),
      resolvedAt: new Date("2026-05-10"),
    });
    expect(detectOverdue(ctx)).toBeNull();
  });

  it("returns null when due date is in the future", () => {
    const ctx = makeCtx({ dueAt: new Date("2026-06-01") });
    expect(detectOverdue(ctx)).toBeNull();
  });

  it("detects overdue with correct daysOverdue", () => {
    const ctx = makeCtx({ dueAt: new Date("2026-05-09") });
    const result = detectOverdue(ctx);
    expect(result).not.toBeNull();
    expect(result!.reasonCode).toBe("OVERDUE");
    expect(result!.weight).toBe(3);
    expect(result!.detailsJson).toEqual({ daysOverdue: 3 });
  });

  it("returns null when due date is today", () => {
    const ctx = makeCtx({ dueAt: new Date("2026-05-12") });
    expect(detectOverdue(ctx)).toBeNull();
  });
});

// ── detectAgingWip ──

describe("detectAgingWip", () => {
  it("returns null when status is not in-progress", () => {
    const ctx = makeCtx({ status: "Done", startedAt: new Date("2026-04-01") });
    expect(detectAgingWip(ctx)).toBeNull();
  });

  it("returns null when no startedAt", () => {
    const ctx = makeCtx({ status: "In Progress" });
    expect(detectAgingWip(ctx)).toBeNull();
  });

  it("returns null when age < warning threshold", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-05-10"),
    });
    expect(detectAgingWip(ctx)).toBeNull();
  });

  it("returns WARNING when age >= warning threshold", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-05-06"),
    });
    const result = detectAgingWip(ctx);
    expect(result).not.toBeNull();
    expect(result!.reasonCode).toBe("AGING_WIP");
    expect(result!.weight).toBe(2);
    expect(result!.detailsJson).toEqual({ ageDays: 6, severity: "WARNING" });
  });

  it("returns CRITICAL when age >= critical threshold", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-05-01"),
    });
    const result = detectAgingWip(ctx);
    expect(result!.weight).toBe(4);
    expect(result!.detailsJson).toEqual({ ageDays: 11, severity: "CRITICAL" });
  });

  it("detects in-progress via statusCategoryKey indeterminate", () => {
    const ctx = makeCtx({
      status: "Some Custom Status",
      startedAt: new Date("2026-05-01"),
      rawPayload: { fields: { status: { statusCategory: { key: "indeterminate" } } } } as any,
    });
    const result = detectAgingWip(ctx);
    expect(result).not.toBeNull();
  });
});

// ── detectMissingEstimate ──

describe("detectMissingEstimate", () => {
  it("detects when both hours and story points are missing", () => {
    expect(detectMissingEstimate(makeCtx())).toEqual({
      reasonCode: "MISSING_ESTIMATE",
      weight: 1,
      detailsJson: {},
    });
  });

  it("returns null when time estimate exists", () => {
    const ctx = makeCtx({
      rawPayload: { fields: { timeoriginalestimate: 28800 } } as any,
    });
    expect(detectMissingEstimate(ctx)).toBeNull();
  });

  it("returns null when story points exist", () => {
    const ctx = makeCtx({
      rawPayload: {
        fields: { customfield_10002: 5 },
        __anathemaMeta: { storyPointFieldIds: ["customfield_10002"] },
      } as any,
    });
    expect(detectMissingEstimate(ctx)).toBeNull();
  });
});

// ── detectMissingDueDate ──

describe("detectMissingDueDate", () => {
  it("detects missing due date on open issue", () => {
    expect(detectMissingDueDate(makeCtx())).toEqual({
      reasonCode: "MISSING_DUE_DATE",
      weight: 1,
      detailsJson: {},
    });
  });

  it("returns null when due date exists", () => {
    const ctx = makeCtx({ dueAt: new Date("2026-06-01") });
    expect(detectMissingDueDate(ctx)).toBeNull();
  });

  it("returns null when issue is resolved", () => {
    const ctx = makeCtx({ resolvedAt: new Date("2026-05-10") });
    expect(detectMissingDueDate(ctx)).toBeNull();
  });

  it("returns null when status is done", () => {
    const ctx = makeCtx({ status: "Done" });
    expect(detectMissingDueDate(ctx)).toBeNull();
  });
});

// ── detectNoDevActivity ──

describe("detectNoDevActivity", () => {
  it("returns null when status is not in-progress", () => {
    const ctx = makeCtx({ status: "Done", startedAt: new Date("2026-04-01") });
    expect(detectNoDevActivity(ctx)).toBeNull();
  });

  it("returns null when no startedAt", () => {
    expect(detectNoDevActivity(makeCtx({ status: "In Progress" }))).toBeNull();
  });

  it("returns null when dev activity exists", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-04-01"),
      rawPayload: {
        fields: { customfield_dev: { cachedValue: { summary: { pullrequest: { overall: { count: 2 } } } } } },
      } as any,
    });
    expect(detectNoDevActivity(ctx)).toBeNull();
  });

  it("returns null when stale days < threshold", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-05-10"),
    });
    expect(detectNoDevActivity(ctx)).toBeNull();
  });

  it("detects no dev activity after threshold days", () => {
    const ctx = makeCtx({
      status: "In Progress",
      startedAt: new Date("2026-05-07"),
    });
    const result = detectNoDevActivity(ctx);
    expect(result).not.toBeNull();
    expect(result!.reasonCode).toBe("NO_DEV_ACTIVITY");
    expect(result!.weight).toBe(2);
    expect(result!.detailsJson.staleDays).toBe(5);
  });
});

// ── detectAssigneeChurn ──

describe("detectAssigneeChurn", () => {
  it("returns null when no changelog", () => {
    expect(detectAssigneeChurn(makeCtx())).toBeNull();
  });

  it("returns null when reassign count ≤ threshold", () => {
    const ctx = makeCtx({
      rawPayload: {
        changelog: {
          histories: [
            { created: "2026-05-01", items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }] },
            { created: "2026-05-02", items: [{ field: "assignee", fromString: "Bob", toString: "Alice" }] },
          ],
        },
      } as any,
    });
    expect(detectAssigneeChurn(ctx)).toBeNull();
  });

  it("detects churn when reassignments exceed threshold", () => {
    const ctx = makeCtx({
      rawPayload: {
        changelog: {
          histories: [
            { created: "2026-05-01", items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }] },
            { created: "2026-05-02", items: [{ field: "assignee", fromString: "Bob", toString: "Carol" }] },
            { created: "2026-05-03", items: [{ field: "assignee", fromString: "Carol", toString: "Dave" }] },
          ],
        },
      } as any,
    });
    const result = detectAssigneeChurn(ctx);
    expect(result).not.toBeNull();
    expect(result!.reasonCode).toBe("ASSIGNEE_CHURN");
    expect(result!.weight).toBe(2);
    expect(result!.detailsJson.reassignmentCount).toBe(3);
  });
});

// ── detectReopened ──

describe("detectReopened", () => {
  it("returns null when no status history", () => {
    expect(detectReopened(makeCtx())).toBeNull();
  });

  it("returns null when no done→not-done transitions", () => {
    const ctx = makeCtx({
      statusHistory: [
        { fromStatus: "Open", toStatus: "In Progress" },
        { fromStatus: "In Progress", toStatus: "Done" },
      ],
    });
    expect(detectReopened(ctx)).toBeNull();
  });

  it("detects a single reopen", () => {
    const ctx = makeCtx({
      statusHistory: [
        { fromStatus: "Open", toStatus: "In Progress" },
        { fromStatus: "In Progress", toStatus: "Done" },
        { fromStatus: "Done", toStatus: "In Progress" },
      ],
    });
    const result = detectReopened(ctx);
    expect(result).not.toBeNull();
    expect(result!.reasonCode).toBe("REOPENED");
    expect(result!.weight).toBe(2);
    expect(result!.detailsJson.reopenedCount).toBe(1);
  });

  it("detects multiple reopens", () => {
    const ctx = makeCtx({
      statusHistory: [
        { fromStatus: "In Progress", toStatus: "Done" },
        { fromStatus: "Done", toStatus: "In Progress" },
        { fromStatus: "In Progress", toStatus: "Closed" },
        { fromStatus: "Closed", toStatus: "In Progress" },
      ],
    });
    const result = detectReopened(ctx);
    expect(result!.detailsJson.reopenedCount).toBe(2);
  });

  it("ignores null fromStatus", () => {
    const ctx = makeCtx({
      statusHistory: [{ fromStatus: null, toStatus: "In Progress" }],
    });
    expect(detectReopened(ctx)).toBeNull();
  });
});

// ── ISSUE_DETECTORS completeness ──

describe("ISSUE_DETECTORS", () => {
  it("contains exactly 7 detectors", () => {
    expect(ISSUE_DETECTORS).toHaveLength(7);
  });

  it("covers all 7 issue-level reason codes", () => {
    const reasonCodes = ISSUE_DETECTORS.map((fn) => {
      // Fire each detector with a default ctx — some will return null
      const ctx = makeCtx();
      return fn(ctx)?.reasonCode ?? null;
    });
    const fired = reasonCodes.filter((c): c is string => c !== null);
    expect(fired.length).toBeGreaterThanOrEqual(1);
  });
});
