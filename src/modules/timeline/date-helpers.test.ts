import { describe, expect, it } from "vitest";

import {
  addDaysInTimezone,
  addDaysToDayKey,
  getEarlierDayKey,
  getDayKey,
  getDayKeyDistance,
  getLaterDayKey,
  getStartOfWeek,
  isWeekStartDayKey,
  isWeekendDayKey,
  normalizeTimelineTimezones,
  parseDateInputInTimezone,
  parseDateOnlyAtHourInTimezone,
} from "@/modules/timeline/date-helpers";

describe("date helpers", () => {
  it("keeps the same calendar day in each connection timezone", () => {
    const moscowStart = parseDateInputInTimezone("2026-04-13", "Europe/Moscow");
    const losAngelesStart = parseDateInputInTimezone(
      "2026-04-13",
      "America/Los_Angeles",
    );

    expect(moscowStart).not.toBeNull();
    expect(losAngelesStart).not.toBeNull();
    expect(moscowStart?.toISOString()).toBe("2026-04-12T21:00:00.000Z");
    expect(losAngelesStart?.toISOString()).toBe("2026-04-13T07:00:00.000Z");
    expect(getDayKey(moscowStart!, "Europe/Moscow")).toBe("2026-04-13");
    expect(getDayKey(losAngelesStart!, "America/Los_Angeles")).toBe("2026-04-13");
  });

  it("uses the scoped timezone instead of UTC when resolving the start of week", () => {
    const boundaryInstant = new Date("2026-04-12T21:30:00.000Z");

    expect(getDayKey(boundaryInstant, "Europe/Moscow")).toBe("2026-04-13");
    expect(getStartOfWeek(boundaryInstant, "Europe/Moscow").toISOString()).toBe(
      "2026-04-12T21:00:00.000Z",
    );
    expect(
      getStartOfWeek(boundaryInstant, "America/Los_Angeles").toISOString(),
    ).toBe("2026-04-06T07:00:00.000Z");
  });

  it("advances by local calendar days across DST", () => {
    const daylightSavingBoundary = parseDateInputInTimezone(
      "2026-03-08",
      "America/Los_Angeles",
    );

    expect(daylightSavingBoundary).not.toBeNull();

    const nextDay = addDaysInTimezone(
      daylightSavingBoundary!,
      1,
      "America/Los_Angeles",
    );

    expect(nextDay.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(getDayKey(nextDay, "America/Los_Angeles")).toBe("2026-03-09");
  });

  it("keeps Jira due dates on the connection day", () => {
    const dueAt = parseDateOnlyAtHourInTimezone(
      "2026-04-16",
      "Pacific/Kiritimati",
      12,
    );

    expect(dueAt).not.toBeNull();
    expect(dueAt?.toISOString()).toBe("2026-04-15T22:00:00.000Z");
    expect(getDayKey(dueAt!, "Pacific/Kiritimati")).toBe("2026-04-16");
  });

  it("keeps day-key helpers stable for mixed-timezone board columns", () => {
    expect(addDaysToDayKey("2026-04-11", 2)).toBe("2026-04-13");
    expect(getEarlierDayKey("2026-04-13", "2026-04-11")).toBe("2026-04-11");
    expect(getLaterDayKey("2026-04-13", "2026-04-11")).toBe("2026-04-13");
    expect(getDayKeyDistance("2026-04-11", "2026-04-14")).toBe(3);
    expect(isWeekendDayKey("2026-04-12")).toBe(true);
    expect(isWeekStartDayKey("2026-04-13")).toBe(true);
  });

  it("keeps a deterministic unique timezone scope list", () => {
    expect(
      normalizeTimelineTimezones([
        "America/Los_Angeles",
        "Europe/Moscow",
        "America/Los_Angeles",
      ]),
    ).toEqual(["America/Los_Angeles", "Europe/Moscow"]);
  });
});
