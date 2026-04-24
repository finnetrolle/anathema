import { DateTime, IANAZone } from "luxon";

import {
  DEFAULT_APP_LOCALE,
  getIntlLocale,
  type AppLocale,
} from "@/modules/i18n/config";

export const DEFAULT_TIMELINE_TIMEZONE = "Europe/Moscow";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const DAY_KEY_FORMATTER_CACHE = new Map<AppLocale, Intl.DateTimeFormat>();
const DAY_KEY_WEEKDAY_FORMATTER_CACHE = new Map<AppLocale, Intl.DateTimeFormat>();

function getDateFormatter(timezone: string, locale: AppLocale) {
  const normalizedTimezone = normalizeTimelineTimezone(timezone);
  const cacheKey = `${locale}:${normalizedTimezone}`;
  const cachedFormatter = DATE_FORMATTER_CACHE.get(cacheKey);

  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    timeZone: normalizedTimezone,
  });
  DATE_FORMATTER_CACHE.set(cacheKey, formatter);

  return formatter;
}

function getDayKeyFormatter(locale: AppLocale) {
  const cachedFormatter = DAY_KEY_FORMATTER_CACHE.get(locale);

  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  DAY_KEY_FORMATTER_CACHE.set(locale, formatter);

  return formatter;
}

function getDayKeyWeekdayFormatter(locale: AppLocale) {
  const cachedFormatter = DAY_KEY_WEEKDAY_FORMATTER_CACHE.get(locale);

  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    weekday: "short",
    timeZone: "UTC",
  });
  DAY_KEY_WEEKDAY_FORMATTER_CACHE.set(locale, formatter);

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

export function formatTimelineDate(
  value: Date,
  timezone: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  return getDateFormatter(timezone, locale).format(value);
}

export function getDayKey(value: Date, timezone: string) {
  return toZonedDateTime(value, timezone).toFormat("yyyy-MM-dd");
}

export function getTodayDayKey(timezone: string, now = new Date()) {
  return getDayKey(now, timezone);
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

export function compareDayKeys(left: string, right: string) {
  return left.localeCompare(right);
}

export function formatTimelineDayKey(
  value: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const parsed = parseDayKey(value);

  return parsed ? getDayKeyFormatter(locale).format(parsed.toJSDate()) : value;
}

export function formatTimelineWeekdayFromDayKey(
  value: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const parsed = parseDayKey(value);

  return parsed
    ? getDayKeyWeekdayFormatter(locale)
        .format(parsed.toJSDate())
        .replace(".", "")
        .toUpperCase()
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

