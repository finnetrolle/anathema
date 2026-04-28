import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAY_WIDTH,
  MIN_DAY_WIDTH,
  MAX_DAY_WIDTH,
  DEFAULT_RANGE_SPAN_IN_DAYS,
  normalizeDayWidth,
  getDefaultTimelineRange,
  resolveTimelineRange,
  createColumns,
  createColumnIndex,
} from "./timeline-range";

// ── constants ──

describe("constants", () => {
  it("DEFAULT_DAY_WIDTH is 120", () => {
    expect(DEFAULT_DAY_WIDTH).toBe(120);
  });

  it("MIN_DAY_WIDTH is 48", () => {
    expect(MIN_DAY_WIDTH).toBe(48);
  });

  it("MAX_DAY_WIDTH is 240", () => {
    expect(MAX_DAY_WIDTH).toBe(240);
  });

  it("DEFAULT_RANGE_SPAN_IN_DAYS is 12", () => {
    expect(DEFAULT_RANGE_SPAN_IN_DAYS).toBe(12);
  });
});

// ── normalizeDayWidth ──

describe("normalizeDayWidth", () => {
  it("returns value within range", () => {
    expect(normalizeDayWidth(100)).toBe(100);
  });

  it("clamps to MIN_DAY_WIDTH", () => {
    expect(normalizeDayWidth(10)).toBe(MIN_DAY_WIDTH);
  });

  it("clamps to MAX_DAY_WIDTH", () => {
    expect(normalizeDayWidth(300)).toBe(MAX_DAY_WIDTH);
  });

  it("returns DEFAULT_DAY_WIDTH for NaN input", () => {
    expect(normalizeDayWidth(NaN)).toBe(DEFAULT_DAY_WIDTH);
  });

  it("returns DEFAULT_DAY_WIDTH for null", () => {
    expect(normalizeDayWidth(null)).toBe(DEFAULT_DAY_WIDTH);
  });

  it("parses string input", () => {
    expect(normalizeDayWidth("80")).toBe(80);
  });

  it("returns DEFAULT_DAY_WIDTH for empty string", () => {
    expect(normalizeDayWidth("")).toBe(DEFAULT_DAY_WIDTH);
  });

  it("rounds fractional values", () => {
    expect(normalizeDayWidth(99.7)).toBe(100);
  });
});

// ── getDefaultTimelineRange ──

describe("getDefaultTimelineRange", () => {
  it("returns valid start and end day keys", () => {
    const result = getDefaultTimelineRange();
    expect(result.startDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.endDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("visibleStart is before visibleEnd", () => {
    const result = getDefaultTimelineRange();
    expect(result.visibleStart.getTime()).toBeLessThan(result.visibleEnd.getTime());
  });

  it("returns timezones array", () => {
    const result = getDefaultTimelineRange();
    expect(Array.isArray(result.timezones)).toBe(true);
    expect(result.timezones.length).toBeGreaterThan(0);
  });

  it("accepts a timezone string", () => {
    const result = getDefaultTimelineRange(new Date(), "Europe/Moscow");
    expect(result.timezones).toContain("Europe/Moscow");
  });
});

// ── resolveTimelineRange ──

describe("resolveTimelineRange", () => {
  it("returns default range with no options", () => {
    const result = resolveTimelineRange();
    expect(result.selectedStartDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.selectedEndDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dayWidth).toBe(DEFAULT_DAY_WIDTH);
  });

  it("uses custom rangeStart and rangeEnd", () => {
    const result = resolveTimelineRange({
      rangeStart: "2026-04-27",
      rangeEnd: "2026-05-01",
    });
    expect(result.selectedStartDayKey).toBe("2026-04-27");
    expect(result.selectedEndDayKey).toBe("2026-05-01");
    expect(result.rangeStartInput).toBe("2026-04-27");
    expect(result.rangeEndInput).toBe("2026-05-01");
  });

  it("clamps rangeEnd to rangeStart when reversed", () => {
    const result = resolveTimelineRange({
      rangeStart: "2026-05-01",
      rangeEnd: "2026-04-27",
    });
    expect(result.selectedEndDayKey).toBe(result.selectedStartDayKey);
  });

  it("normalizes custom dayWidth", () => {
    const result = resolveTimelineRange({ dayWidth: 80 });
    expect(result.dayWidth).toBe(80);
  });

  it("falls back to default for invalid rangeStart", () => {
    const result = resolveTimelineRange({ rangeStart: "not-a-date" });
    expect(result.selectedStartDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses data bounds when no custom range and data provided", () => {
    const dataBounds = {
      minDate: new Date("2026-03-01"),
      maxDate: new Date("2026-03-15"),
    };
    const result = resolveTimelineRange({}, dataBounds);
    // Default range is used (dataBounds only used when custom range is set but invalid)
    expect(result.selectedStartDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("populates todayDayKeys", () => {
    const result = resolveTimelineRange();
    expect(result.todayDayKeys.length).toBeGreaterThan(0);
    for (const dayKey of result.todayDayKeys) {
      expect(dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ── createColumns ──

describe("createColumns", () => {
  it("creates columns for a work week (Mon-Fri)", () => {
    // 2026-04-27 is a Monday
    const columns = createColumns("2026-04-27", "2026-05-01", [], "en");
    expect(columns.length).toBe(5);
    expect(columns[0].dayKey).toBe("2026-04-27");
    expect(columns[4].dayKey).toBe("2026-05-01");
  });

  it("skips weekend days", () => {
    // 2026-04-25 is Saturday, 2026-04-26 is Sunday
    const columns = createColumns("2026-04-25", "2026-04-28", [], "en");
    const dayKeys = columns.map((c) => c.dayKey);
    expect(dayKeys).not.toContain("2026-04-25");
    expect(dayKeys).not.toContain("2026-04-26");
    expect(dayKeys).toContain("2026-04-27");
    expect(dayKeys).toContain("2026-04-28");
  });

  it("marks today correctly", () => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const columns = createColumns(todayKey, todayKey, [todayKey], "en");
    const todayColumns = columns.filter((c) => c.isToday);
    expect(todayColumns.length).toBeGreaterThan(0);
  });

  it("marks week start correctly", () => {
    // 2026-04-27 is a Monday
    const columns = createColumns("2026-04-27", "2026-04-27", [], "en");
    expect(columns[0].isWeekStart).toBe(true);
  });

  it("generates labels", () => {
    const columns = createColumns("2026-04-27", "2026-04-27", [], "en");
    expect(columns[0].label).toBeTruthy();
    expect(columns[0].key).toBe("2026-04-27");
  });
});

// ── createColumnIndex ──

describe("createColumnIndex", () => {
  it("maps day keys to 1-based indices", () => {
    const columns = createColumns("2026-04-27", "2026-04-29", [], "en");
    const index = createColumnIndex(columns);
    expect(index.get("2026-04-27")).toBe(1);
    expect(index.get("2026-04-28")).toBe(2);
    expect(index.get("2026-04-29")).toBe(3);
  });

  it("returns empty map for empty columns", () => {
    const index = createColumnIndex([]);
    expect(index.size).toBe(0);
  });
});
