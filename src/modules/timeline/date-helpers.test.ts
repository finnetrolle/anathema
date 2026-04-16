import assert from "node:assert/strict";
import test from "node:test";

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
} from "./date-helpers.ts";

test("parseDateInputInTimezone keeps the same calendar day in each connection timezone", () => {
  const moscowStart = parseDateInputInTimezone("2026-04-13", "Europe/Moscow");
  const losAngelesStart = parseDateInputInTimezone(
    "2026-04-13",
    "America/Los_Angeles",
  );

  assert.ok(moscowStart);
  assert.ok(losAngelesStart);
  assert.equal(moscowStart.toISOString(), "2026-04-12T21:00:00.000Z");
  assert.equal(losAngelesStart.toISOString(), "2026-04-13T07:00:00.000Z");
  assert.equal(getDayKey(moscowStart, "Europe/Moscow"), "2026-04-13");
  assert.equal(getDayKey(losAngelesStart, "America/Los_Angeles"), "2026-04-13");
});

test("getStartOfWeek uses the scoped timezone instead of UTC", () => {
  const boundaryInstant = new Date("2026-04-12T21:30:00.000Z");

  assert.equal(getDayKey(boundaryInstant, "Europe/Moscow"), "2026-04-13");
  assert.equal(
    getStartOfWeek(boundaryInstant, "Europe/Moscow").toISOString(),
    "2026-04-12T21:00:00.000Z",
  );
  assert.equal(
    getStartOfWeek(boundaryInstant, "America/Los_Angeles").toISOString(),
    "2026-04-06T07:00:00.000Z",
  );
});

test("addDaysInTimezone advances by local calendar days across DST", () => {
  const daylightSavingBoundary = parseDateInputInTimezone(
    "2026-03-08",
    "America/Los_Angeles",
  );

  assert.ok(daylightSavingBoundary);

  const nextDay = addDaysInTimezone(
    daylightSavingBoundary,
    1,
    "America/Los_Angeles",
  );

  assert.equal(nextDay.toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(getDayKey(nextDay, "America/Los_Angeles"), "2026-03-09");
});

test("parseDateOnlyAtHourInTimezone keeps Jira due dates on the connection day", () => {
  const dueAt = parseDateOnlyAtHourInTimezone(
    "2026-04-16",
    "Pacific/Kiritimati",
    12,
  );

  assert.ok(dueAt);
  assert.equal(dueAt.toISOString(), "2026-04-15T22:00:00.000Z");
  assert.equal(getDayKey(dueAt, "Pacific/Kiritimati"), "2026-04-16");
});

test("day-key helpers stay stable for mixed-timezone board columns", () => {
  assert.equal(addDaysToDayKey("2026-04-11", 2), "2026-04-13");
  assert.equal(getEarlierDayKey("2026-04-13", "2026-04-11"), "2026-04-11");
  assert.equal(getLaterDayKey("2026-04-13", "2026-04-11"), "2026-04-13");
  assert.equal(getDayKeyDistance("2026-04-11", "2026-04-14"), 3);
  assert.equal(isWeekendDayKey("2026-04-12"), true);
  assert.equal(isWeekStartDayKey("2026-04-13"), true);
});

test("normalizeTimelineTimezones keeps a deterministic unique scope list", () => {
  assert.deepEqual(
    normalizeTimelineTimezones([
      "America/Los_Angeles",
      "Europe/Moscow",
      "America/Los_Angeles",
    ]),
    ["America/Los_Angeles", "Europe/Moscow"],
  );
});
