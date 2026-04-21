import { describe, expect, it } from "vitest";

import { resolveTimelineTaskBounds } from "@/modules/timeline/task-bounds";

describe("resolveTimelineTaskBounds", () => {
  it("prefers the actual start date when work has already started", () => {
    const bounds = resolveTimelineTaskBounds({
      timezone: "Europe/Moscow",
      startAt: new Date("2026-04-14T08:00:00.000Z"),
      dueAt: new Date("2026-04-18T09:00:00.000Z"),
      markerAt: new Date("2026-04-18T09:00:00.000Z"),
      markerKind: "DUE",
      estimateHours: 24,
    });

    expect(bounds.startDayKey).toBe("2026-04-14");
    expect(bounds.endDayKey).toBe("2026-04-18");
  });

  it("derives the left boundary from due date and estimate for not-started work", () => {
    const bounds = resolveTimelineTaskBounds({
      timezone: "Europe/Moscow",
      startAt: null,
      dueAt: new Date("2026-03-18T09:00:00.000Z"),
      markerAt: new Date("2026-03-18T09:00:00.000Z"),
      markerKind: "DUE",
      estimateHours: 24,
    });

    expect(bounds.startDayKey).toBe("2026-03-16");
    expect(bounds.endDayKey).toBe("2026-03-18");
  });

  it("anchors not-started work without due date on today and skips weekends", () => {
    const bounds = resolveTimelineTaskBounds({
      timezone: "Europe/Moscow",
      startAt: null,
      dueAt: null,
      markerAt: null,
      markerKind: "NONE",
      estimateHours: 24,
      now: new Date("2026-04-17T00:00:00.000Z"),
    });

    expect(bounds.startDayKey).toBe("2026-04-17");
    expect(bounds.endDayKey).toBe("2026-04-21");
  });
});
