import { describe, expect, it } from "vitest";

import {
  buildTimelineModel,
  resolveTimelineRange,
} from "@/modules/timeline/build-timeline";
import type { TimelineEpic, TimelineIssue } from "@/modules/timeline/types";

function makeIssue(overrides: Partial<TimelineIssue> = {}): TimelineIssue {
  return {
    id: "issue-1",
    key: "AN-1",
    summary: "Ship quality gates",
    issueUrl: null,
    timezone: "Europe/Moscow",
    componentName: "Platform",
    epicId: "epic-1",
    epicKey: "AN-EPIC",
    epicSummary: "Timeline hygiene",
    assigneeName: "Alice",
    assigneeColor: "#83c8ff",
    status: "In Progress",
    isCompleted: false,
    createdAt: "2026-04-10T08:00:00.000Z",
    startAt: "2026-04-10T08:00:00.000Z",
    dueAt: null,
    resolvedAt: null,
    estimateHours: null,
    estimateStoryPoints: null,
    observedPeople: ["Alice"],
    assigneeHistory: ["Alice"],
    authorName: "Alice",
    markerAt: "2026-04-14T18:00:00.000Z",
    markerKind: "NONE",
    pullRequestStatus: "NONE",
    pullRequestCount: 0,
    commitCount: 0,
    isMissingDueDate: false,
    riskScore: 0,
    riskLevel: "LOW",
    riskReasons: [],
    ...overrides,
  };
}

function makeEpic(issues: TimelineIssue[]): TimelineEpic {
  return {
    id: "epic-1",
    componentName: "Platform",
    key: "AN-EPIC",
    summary: "Timeline hygiene",
    issues,
  };
}

describe("buildTimelineModel", () => {
  it("skips weekend columns when calculating item spans", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-10",
        rangeEnd: "2026-04-14",
      },
      null,
      new Date("2026-04-10T00:00:00.000Z"),
    );
    const model = buildTimelineModel([makeEpic([makeIssue()])], {
      resolvedRange,
    });

    expect(model.columns.map((column) => column.dayKey)).toEqual([
      "2026-04-10",
      "2026-04-13",
      "2026-04-14",
    ]);
    expect(model.rows[0]?.items[0]?.startColumn).toBe(1);
    expect(model.rows[0]?.items[0]?.span).toBe(3);
  });

  it("clips items to the visible workday range", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-13",
        rangeEnd: "2026-04-17",
      },
      null,
      new Date("2026-04-13T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: "2026-04-10T08:00:00.000Z",
            markerAt: "2026-04-20T18:00:00.000Z",
          }),
        ]),
      ],
      { resolvedRange },
    );

    expect(model.rows[0]?.items[0]?.startColumn).toBe(1);
    expect(model.rows[0]?.items[0]?.span).toBe(5);
  });

  it("normalizes inverted custom ranges and drops issues outside the visible window", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-17",
        rangeEnd: "2026-04-14",
        dayWidth: "500",
      },
      null,
      new Date("2026-04-13T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: "2026-04-20T08:00:00.000Z",
            markerAt: "2026-04-21T18:00:00.000Z",
          }),
        ]),
      ],
      { resolvedRange },
    );

    expect(resolvedRange.selectedStartDayKey).toBe("2026-04-17");
    expect(resolvedRange.selectedEndDayKey).toBe("2026-04-17");
    expect(resolvedRange.dayWidth).toBe(240);
    expect(model.rows).toEqual([]);
  });

  it("keeps risk metadata on rendered timeline items", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-10",
        rangeEnd: "2026-04-14",
      },
      null,
      new Date("2026-04-10T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            riskScore: 42,
            riskLevel: "HIGH",
            riskReasons: [
              {
                reasonCode: "NO_DEV_ACTIVITY",
                weight: 12,
                title: "No dev activity",
                narrative: "There has been no PR or commit activity for 4 day(s).",
                recommendedAction:
                  "Check whether real work is happening outside the codebase.",
                details: {
                  staleDays: 4,
                },
              },
            ],
          }),
        ]),
      ],
      { resolvedRange },
    );

    expect(model.rows[0]?.items[0]?.riskScore).toBe(42);
    expect(model.rows[0]?.items[0]?.riskLevel).toBe("HIGH");
    expect(model.rows[0]?.items[0]?.riskReasons).toHaveLength(1);
    expect(model.rows[0]?.items[0]?.riskReasons[0]?.reasonCode).toBe("NO_DEV_ACTIVITY");
  });

  it("places not-started tasks from due date and estimate in working days", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-03-16",
        rangeEnd: "2026-03-18",
      },
      null,
      new Date("2026-03-16T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: null,
            dueAt: "2026-03-18T09:00:00.000Z",
            markerAt: "2026-03-18T09:00:00.000Z",
            markerKind: "DUE",
            estimateHours: 24,
          }),
        ]),
      ],
      { resolvedRange },
    );

    expect(model.rows[0]?.items[0]?.startColumn).toBe(1);
    expect(model.rows[0]?.items[0]?.span).toBe(3);
  });

  it("renders same-day issue with span=1", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-13",
        rangeEnd: "2026-04-17",
      },
      null,
      new Date("2026-04-13T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: "2026-04-14T08:00:00.000Z",
            markerAt: "2026-04-14T18:00:00.000Z",
          }),
        ]),
      ],
      { resolvedRange },
    );

    expect(model.rows[0]?.items[0]?.span).toBe(1);
    expect(model.rows[0]?.items[0]?.startColumn).toBe(2);
  });

  it("renders label fields correctly", () => {
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-13",
        rangeEnd: "2026-04-17",
      },
      null,
      new Date("2026-04-13T00:00:00.000Z"),
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: "2026-04-13T08:00:00.000Z",
            markerAt: "2026-04-14T18:00:00.000Z",
            markerKind: "DONE",
            resolvedAt: "2026-04-14T18:00:00.000Z",
            dueAt: "2026-04-15T18:00:00.000Z",
            observedPeople: ["Alice", "Bob"],
            assigneeHistory: ["Alice"],
            authorName: "Alice",
            pullRequestStatus: "MERGED",
            pullRequestCount: 2,
            commitCount: 5,
          }),
        ]),
      ],
      { resolvedRange, locale: "en" },
    );

    const item = model.rows[0]?.items[0];
    expect(item).toBeDefined();
    expect(item!.markerLabel).toContain("Done");
    expect(item!.startLabel).toContain("Started");
    expect(item!.dueLabel).toContain("Due");
    expect(item!.resolvedLabel).toContain("Finished");
    expect(item!.observedPeople).toEqual(["Alice", "Bob"]);
    expect(item!.pullRequestStatus).toBe("MERGED");
    expect(item!.pullRequestCount).toBe(2);
    expect(item!.commitCount).toBe(5);
  });

  it("anchors not-started tasks without due date on today and extends them by estimate", () => {
    const now = new Date("2026-04-17T00:00:00.000Z");
    const resolvedRange = resolveTimelineRange(
      {
        timezone: "Europe/Moscow",
        rangeStart: "2026-04-17",
        rangeEnd: "2026-04-21",
      },
      null,
      now,
    );
    const model = buildTimelineModel(
      [
        makeEpic([
          makeIssue({
            startAt: null,
            dueAt: null,
            markerAt: "2026-04-10T09:00:00.000Z",
            markerKind: "NONE",
            estimateHours: 24,
          }),
        ]),
      ],
      {
        resolvedRange,
        now,
      },
    );

    expect(model.rows[0]?.items[0]?.startColumn).toBe(1);
    expect(model.rows[0]?.items[0]?.span).toBe(3);
  });
});
