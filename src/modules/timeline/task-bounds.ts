import {
  addDaysToDayKey,
  getDayKey,
  getTodayDayKey,
  isWeekendDayKey,
  normalizeTimelineTimezone,
  parseDateOnlyAtHourInTimezone,
} from "@/modules/timeline/date-helpers";
import type { TimelineMarkerKind } from "@/modules/timeline/types";

export const WORK_HOURS_PER_DAY = 8;

const PLANNED_TIMELINE_HOUR = 12;

export type TimelineTaskBoundsInput = {
  timezone?: string | null;
  startAt: Date | null;
  dueAt: Date | null;
  markerAt: Date | null;
  markerKind: TimelineMarkerKind;
  estimateHours: number | null;
  now?: Date;
};

export type TimelineTaskBounds = {
  startDate: Date;
  endDate: Date;
  startDayKey: string;
  endDayKey: string;
};

function toPlannedDate(dayKey: string, timezone: string) {
  return parseDateOnlyAtHourInTimezone(dayKey, timezone, PLANNED_TIMELINE_HOUR);
}

export function estimateHoursToTimelineDays(estimateHours: number | null) {
  if (
    typeof estimateHours !== "number" ||
    !Number.isFinite(estimateHours) ||
    estimateHours <= 0
  ) {
    return 1;
  }

  return Math.max(1, Math.ceil(estimateHours / WORK_HOURS_PER_DAY));
}

export function addWorkdaysToDayKey(dayKey: string, amount: number) {
  if (amount === 0) {
    return dayKey;
  }

  const direction = amount < 0 ? -1 : 1;
  let currentDayKey = dayKey;
  let remainingDays = Math.abs(amount);

  while (remainingDays > 0) {
    currentDayKey = addDaysToDayKey(currentDayKey, direction);

    if (!isWeekendDayKey(currentDayKey)) {
      remainingDays -= 1;
    }
  }

  return currentDayKey;
}

export function resolveTimelineTaskBounds(
  input: TimelineTaskBoundsInput,
): TimelineTaskBounds {
  const timezone = normalizeTimelineTimezone(input.timezone);
  const now = input.now ?? new Date();
  const actualStartDate = input.startAt;
  const actualEndDate = input.markerAt ?? input.dueAt ?? actualStartDate ?? now;

  if (actualStartDate) {
    return {
      startDate: actualStartDate,
      endDate: actualEndDate,
      startDayKey: getDayKey(actualStartDate, timezone),
      endDayKey: getDayKey(actualEndDate, timezone),
    };
  }

  const plannedSpanInDays = estimateHoursToTimelineDays(input.estimateHours);
  const planningAnchorDate =
    input.dueAt ?? (input.markerKind === "DONE" ? input.markerAt : null);

  if (planningAnchorDate) {
    const anchorDayKey = getDayKey(planningAnchorDate, timezone);
    const startDayKey = addWorkdaysToDayKey(anchorDayKey, -(plannedSpanInDays - 1));
    const endDate =
      input.markerKind === "DONE" && input.markerAt
        ? input.markerAt
        : planningAnchorDate;

    return {
      startDate: toPlannedDate(startDayKey, timezone) ?? planningAnchorDate,
      endDate,
      startDayKey,
      endDayKey: getDayKey(endDate, timezone),
    };
  }

  const startDayKey = getTodayDayKey(timezone, now);
  const endDayKey = addWorkdaysToDayKey(startDayKey, plannedSpanInDays - 1);

  return {
    startDate: toPlannedDate(startDayKey, timezone) ?? now,
    endDate: toPlannedDate(endDayKey, timezone) ?? now,
    startDayKey,
    endDayKey,
  };
}
