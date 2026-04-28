import type { TimelineColumn } from "@/modules/timeline/types";
import type { AppLocale } from "@/modules/i18n/config";
import {
  addDaysToDayKey,
  compareDayKeys,
  formatTimelineDayKey,
  formatTimelineWeekdayFromDayKey,
  getDayKey,
  getEarlierDayKey,
  getEndOfDay,
  getLaterDayKey,
  getStartOfWeek,
  getTodayDayKey,
  isValidDayKey,
  isWeekStartDayKey,
  isWeekendDayKey,
  normalizeTimelineTimezones,
  parseDateInputInTimezone,
} from "@/modules/timeline/date-helpers";

export const DEFAULT_DAY_WIDTH = 120;
export const MIN_DAY_WIDTH = 48;
export const MAX_DAY_WIDTH = 240;
export const DEFAULT_RANGE_SPAN_IN_DAYS = 12;

export type TimelineRangeOptions = {
  timezone?: string | null;
  timezones?: string[] | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  dayWidth?: string | number | null;
};

export type TimelineDateBounds = {
  minDate: Date | null;
  maxDate: Date | null;
};

export type TimelineResolvedRange = {
  timezones: string[];
  selectedStartDayKey: string;
  selectedEndDayKey: string;
  todayDayKeys: string[];
  visibleStart: Date;
  visibleEnd: Date;
  rangeStartInput: string;
  rangeEndInput: string;
  dayWidth: number;
};

export function resolveTimezones(
  values: Array<string | null | undefined> = [],
) {
  const normalized = normalizeTimelineTimezones(values);

  return normalized.length > 0 ? normalized : normalizeTimelineTimezones();
}

function getDefaultDayKeyRange(
  now = new Date(),
  timezones: string[] = resolveTimezones(),
) {
  const startDayKey = getEarlierDayKey(
    ...timezones.map((timezone) => getDayKey(getStartOfWeek(now, timezone), timezone)),
  )!;
  const endDayKey = getLaterDayKey(
    ...timezones.map((timezone) =>
      addDaysToDayKey(getDayKey(getStartOfWeek(now, timezone), timezone), DEFAULT_RANGE_SPAN_IN_DAYS),
    ),
  )!;

  return {
    startDayKey,
    endDayKey,
  };
}

function getVisibleStartForDayKey(dayKey: string, timezones: string[]) {
  return new Date(
    Math.min(
      ...timezones.map((timezone) => parseDateInputInTimezone(dayKey, timezone)!.getTime()),
    ),
  );
}

function getVisibleEndForDayKey(dayKey: string, timezones: string[]) {
  return new Date(
    Math.max(
      ...timezones.map((timezone) =>
        getEndOfDay(parseDateInputInTimezone(dayKey, timezone)!, timezone).getTime(),
      ),
    ),
  );
}

function getBoundDayKey(
  value: Date | null,
  timezones: string[],
  direction: "earlier" | "later",
) {
  if (!value) {
    return null;
  }

  const dayKeys = timezones.map((timezone) => getDayKey(value, timezone));

  return direction === "earlier"
    ? getEarlierDayKey(...dayKeys)
    : getLaterDayKey(...dayKeys);
}

export function getDefaultTimelineRange(
  now = new Date(),
  timezoneOrTimezones?: string[] | string | null,
) {
  const timezones = resolveTimezones(
    Array.isArray(timezoneOrTimezones)
      ? timezoneOrTimezones
      : [timezoneOrTimezones],
  );
  const dayKeyRange = getDefaultDayKeyRange(now, timezones);

  return {
    timezones,
    startDayKey: dayKeyRange.startDayKey,
    endDayKey: dayKeyRange.endDayKey,
    visibleStart: getVisibleStartForDayKey(dayKeyRange.startDayKey, timezones),
    visibleEnd: getVisibleEndForDayKey(dayKeyRange.endDayKey, timezones),
  };
}

export function normalizeDayWidth(value?: string | number | null) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_DAY_WIDTH;
  }

  return Math.min(
    MAX_DAY_WIDTH,
    Math.max(MIN_DAY_WIDTH, Math.round(numericValue)),
  );
}

export function resolveTimelineRange(
  options: TimelineRangeOptions = {},
  dataBounds?: TimelineDateBounds | null,
  now = new Date(),
): TimelineResolvedRange {
  const timezones = resolveTimezones([
    ...(options.timezones ?? []),
    options.timezone,
  ]);
  const defaultRange = getDefaultDayKeyRange(now, timezones);
  const fallbackStartDayKey =
    getBoundDayKey(dataBounds?.minDate ?? null, timezones, "earlier") ??
    defaultRange.startDayKey;
  const fallbackEndDayKey =
    getBoundDayKey(dataBounds?.maxDate ?? null, timezones, "later") ??
    defaultRange.endDayKey;
  const hasCustomRange =
    typeof options.rangeStart === "string" || typeof options.rangeEnd === "string";
  const selectedStartDayKey = hasCustomRange
    ? isValidDayKey(options.rangeStart)
      ? options.rangeStart!
      : fallbackStartDayKey
    : defaultRange.startDayKey;
  const selectedEndDayKeyCandidate = hasCustomRange
    ? isValidDayKey(options.rangeEnd)
      ? options.rangeEnd!
      : fallbackEndDayKey
    : defaultRange.endDayKey;
  const selectedEndDayKey =
    compareDayKeys(selectedEndDayKeyCandidate, selectedStartDayKey) < 0
      ? selectedStartDayKey
      : selectedEndDayKeyCandidate;

  return {
    timezones,
    selectedStartDayKey,
    selectedEndDayKey,
    todayDayKeys: [...new Set(timezones.map((timezone) => getTodayDayKey(timezone, now)))],
    visibleStart: getVisibleStartForDayKey(selectedStartDayKey, timezones),
    visibleEnd: getVisibleEndForDayKey(selectedEndDayKey, timezones),
    rangeStartInput: selectedStartDayKey,
    rangeEndInput: selectedEndDayKey,
    dayWidth: normalizeDayWidth(options.dayWidth),
  };
}

export function createColumns(
  startDayKey: string,
  endDayKey: string,
  todayDayKeys: string[],
  locale: AppLocale,
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const todayKeySet = new Set(todayDayKeys);

  for (
    let currentDayKey = startDayKey;
    compareDayKeys(currentDayKey, endDayKey) <= 0;
    currentDayKey = addDaysToDayKey(currentDayKey, 1)
  ) {
    if (isWeekendDayKey(currentDayKey)) {
      continue;
    }

    const isWeekStart = isWeekStartDayKey(currentDayKey);

    columns.push({
      key: currentDayKey,
      dayKey: currentDayKey,
      label: formatTimelineDayKey(currentDayKey, locale),
      isWeekStart,
      isToday: todayKeySet.has(currentDayKey),
      weekLabel: isWeekStart
        ? formatTimelineWeekdayFromDayKey(currentDayKey, locale)
        : null,
    });
  }

  return columns;
}

export function createColumnIndex(columns: TimelineColumn[]) {
  return new Map(columns.map((column, index) => [column.dayKey, index + 1]));
}
