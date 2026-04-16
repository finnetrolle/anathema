import { DateTime, IANAZone } from "luxon";

export const DEFAULT_TIMELINE_TIMEZONE = "Europe/Moscow";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const DAY_KEY_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  timeZone: "UTC",
});

function getDateFormatter(timezone: string) {
  const normalizedTimezone = normalizeTimelineTimezone(timezone);
  const cachedFormatter = DATE_FORMATTER_CACHE.get(normalizedTimezone);

  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: normalizedTimezone,
  });
  DATE_FORMATTER_CACHE.set(normalizedTimezone, formatter);

  return formatter;
}

function getWeekdayFormatter(timezone: string) {
  const normalizedTimezone = normalizeTimelineTimezone(timezone);
  const cachedFormatter = WEEKDAY_FORMATTER_CACHE.get(normalizedTimezone);

  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    timeZone: normalizedTimezone,
  });
  WEEKDAY_FORMATTER_CACHE.set(normalizedTimezone, formatter);

  return formatter;
}

function toZonedDateTime(value: Date, timezone: string) {
  return DateTime.fromJSDate(value, {
    zone: normalizeTimelineTimezone(timezone),
  });
}

function parseDateOnly(value: string, timezone: string) {
  const parsed = DateTime.fromISO(value, {
    zone: normalizeTimelineTimezone(timezone),
  });

  return parsed.isValid ? parsed : null;
}

function parseDayKey(value: string) {
  if (!DATE_INPUT_PATTERN.test(value)) {
    return null;
  }

  const parsed = DateTime.fromISO(value, {
    zone: "UTC",
  });

  return parsed.isValid ? parsed : null;
}

export function normalizeTimelineTimezone(timezone?: string | null) {
  const normalizedTimezone = timezone?.trim();

  if (!normalizedTimezone || !IANAZone.isValidZone(normalizedTimezone)) {
    return DEFAULT_TIMELINE_TIMEZONE;
  }

  return normalizedTimezone;
}

export function normalizeTimelineTimezones(
  values: Array<string | null | undefined> = [],
) {
  const normalized = values.map((value) => normalizeTimelineTimezone(value));

  return [
    ...new Set(
      normalized.length > 0 ? normalized : [DEFAULT_TIMELINE_TIMEZONE],
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function isValidDayKey(value?: string | null) {
  return Boolean(value && DATE_INPUT_PATTERN.test(value));
}

export function formatTimelineDate(value: Date, timezone: string) {
  return getDateFormatter(timezone).format(value);
}

export function formatTimelineWeekday(value: Date, timezone: string) {
  return getWeekdayFormatter(timezone).format(value).replace(".", "").toUpperCase();
}

export function getDayKey(value: Date, timezone: string) {
  return toZonedDateTime(value, timezone).toFormat("yyyy-MM-dd");
}

export function getTodayDayKey(timezone: string, now = new Date()) {
  return getDayKey(now, timezone);
}

export function getStartOfDay(value: Date, timezone: string) {
  return toZonedDateTime(value, timezone).startOf("day").toUTC().toJSDate();
}

export function getEndOfDay(value: Date, timezone: string) {
  return toZonedDateTime(value, timezone).endOf("day").toUTC().toJSDate();
}

export function getStartOfWeek(value: Date, timezone: string) {
  const zonedDate = toZonedDateTime(value, timezone).startOf("day");

  return zonedDate.minus({ days: zonedDate.weekday - 1 }).toUTC().toJSDate();
}

export function parseDateInputInTimezone(
  value: string | null | undefined,
  timezone: string,
) {
  if (!value || !DATE_INPUT_PATTERN.test(value)) {
    return null;
  }

  const parsed = parseDateOnly(value, timezone);

  return parsed ? parsed.startOf("day").toUTC().toJSDate() : null;
}

export function parseDateOnlyAtHourInTimezone(
  value: string | null | undefined,
  timezone: string,
  hour = 12,
) {
  if (!value || !DATE_INPUT_PATTERN.test(value)) {
    return null;
  }

  const parsed = parseDateOnly(value, timezone);

  return parsed
    ? parsed.set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate()
    : null;
}

export function addDaysInTimezone(value: Date, amount: number, timezone: string) {
  return toZonedDateTime(value, timezone)
    .startOf("day")
    .plus({ days: amount })
    .toUTC()
    .toJSDate();
}

export function isWeekendInTimezone(value: Date, timezone: string) {
  const weekday = toZonedDateTime(value, timezone).weekday;

  return weekday === 6 || weekday === 7;
}

export function isWeekStartInTimezone(value: Date, timezone: string) {
  return toZonedDateTime(value, timezone).weekday === 1;
}

export function toDateInputValue(value: Date, timezone: string) {
  return getDayKey(value, timezone);
}

export function compareDayKeys(left: string, right: string) {
  return left.localeCompare(right);
}

export function formatTimelineDayKey(value: string) {
  const parsed = parseDayKey(value);

  return parsed ? DAY_KEY_FORMATTER.format(parsed.toJSDate()) : value;
}

export function formatTimelineWeekdayFromDayKey(value: string) {
  const parsed = parseDayKey(value);

  return parsed
    ? DAY_KEY_WEEKDAY_FORMATTER.format(parsed.toJSDate()).replace(".", "").toUpperCase()
    : value;
}

export function addDaysToDayKey(value: string, amount: number) {
  const parsed = parseDayKey(value);

  return parsed ? parsed.plus({ days: amount }).toFormat("yyyy-MM-dd") : value;
}

export function isWeekendDayKey(value: string) {
  const parsed = parseDayKey(value);

  return parsed ? parsed.weekday === 6 || parsed.weekday === 7 : false;
}

export function isWeekStartDayKey(value: string) {
  const parsed = parseDayKey(value);

  return parsed ? parsed.weekday === 1 : false;
}

export function getDayKeyDistance(left: string, right: string) {
  const leftDate = parseDayKey(left);
  const rightDate = parseDayKey(right);

  if (!leftDate || !rightDate) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(Math.round(rightDate.diff(leftDate, "days").days));
}

export function getEarlierDayKey(...values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && isValidDayKey(value))
    .sort(compareDayKeys)[0] ?? null;
}

export function getLaterDayKey(...values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && isValidDayKey(value))
    .sort(compareDayKeys)
    .at(-1) ?? null;
}

export function getCalendarDayDistance(left: Date, right: Date, timezone: string) {
  const leftDate = toZonedDateTime(left, timezone).startOf("day");
  const rightDate = toZonedDateTime(right, timezone).startOf("day");

  return Math.abs(Math.round(rightDate.diff(leftDate, "days").days));
}
