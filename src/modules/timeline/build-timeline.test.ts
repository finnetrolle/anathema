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
});
