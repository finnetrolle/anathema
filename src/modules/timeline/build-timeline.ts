import type {
  TimelineColumn,
  TimelineEpic,
  TimelineIssue,
  TimelineMarkerKind,
  TimelineModel,
  TimelineRow,
  TimelineRowItem,
} from "@/modules/timeline/types";
import { deriveAssigneeColor } from "@/modules/jira/derive";
import {
  addDaysToDayKey,
  compareDayKeys,
  formatTimelineDate,
  formatTimelineDayKey,
  formatTimelineWeekdayFromDayKey,
  getDayKey,
  getDayKeyDistance,
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

export const DEFAULT_DAY_WIDTH = 72;
const MIN_DAY_WIDTH = 48;
const MAX_DAY_WIDTH = 240;
const DEFAULT_RANGE_SPAN_IN_DAYS = 15;

type TimelineRangeOptions = {
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

type BuildTimelineOptions = TimelineRangeOptions & {
  resolvedRange?: TimelineResolvedRange;
};

function assertDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function collectDateBounds(dates: Array<Date | null>) {
  const validDates = dates.filter((date): date is Date => date !== null);

  if (validDates.length === 0) {
    return {
      minDate: null,
      maxDate: null,
    } satisfies TimelineDateBounds;
  }

  return {
    minDate: new Date(Math.min(...validDates.map(Number))),
    maxDate: new Date(Math.max(...validDates.map(Number))),
  } satisfies TimelineDateBounds;
}

function resolveTimezones(
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

function createColumns(
  startDayKey: string,
  endDayKey: string,
  todayDayKeys: string[],
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
      label: formatTimelineDayKey(currentDayKey),
      isWeekStart,
      isToday: todayKeySet.has(currentDayKey),
      weekLabel: isWeekStart ? formatTimelineWeekdayFromDayKey(currentDayKey) : null,
    });
  }

  return columns;
}

function createColumnIndex(columns: TimelineColumn[]) {
  return new Map(columns.map((column, index) => [column.dayKey, index + 1]));
}

function findWorkdayInRange(
  dayKey: string,
  direction: -1 | 1,
  visibleStartDayKey: string,
  visibleEndDayKey: string,
) {
  for (
    let currentDayKey = dayKey;
    compareDayKeys(currentDayKey, visibleStartDayKey) >= 0 &&
    compareDayKeys(currentDayKey, visibleEndDayKey) <= 0;
    currentDayKey = addDaysToDayKey(currentDayKey, direction)
  ) {
    if (!isWeekendDayKey(currentDayKey)) {
      return currentDayKey;
    }
  }

  return null;
}

function findNearestWorkday(
  dayKey: string,
  visibleStartDayKey: string,
  visibleEndDayKey: string,
) {
  const previous = findWorkdayInRange(
    dayKey,
    -1,
    visibleStartDayKey,
    visibleEndDayKey,
  );
  const next = findWorkdayInRange(dayKey, 1, visibleStartDayKey, visibleEndDayKey);

  if (previous && next) {
    return getDayKeyDistance(previous, dayKey) <= getDayKeyDistance(next, dayKey)
      ? previous
      : next;
  }

  return previous ?? next;
}

function createMarkerLabel(
  kind: TimelineMarkerKind,
  value: Date | null,
  timezone: string,
) {
  if (!value) {
    return "No due or done date";
  }

  const prefix =
    kind === "DONE" ? "Done" : kind === "DUE" ? "Due" : "Observed";

  return `${prefix} · ${formatTimelineDate(value, timezone)}`;
}

function createDateLabel(
  prefix: string,
  value: Date | null,
  timezone: string,
) {
  if (!value) {
    return null;
  }

  return `${prefix} · ${formatTimelineDate(value, timezone)}`;
}

function createStartLabel(value: Date | null, timezone: string) {
  return createDateLabel("Started", value, timezone);
}

function buildRowItem(
  columnIndex: Map<string, number>,
  visibleStartDayKey: string,
  visibleEndDayKey: string,
  issue: TimelineIssue,
): TimelineRowItem | null {
  const markerDate = assertDate(issue.markerAt);
  const createdDate = assertDate(issue.createdAt);
  const actualStartDate = assertDate(issue.startAt);
  const dueDate = assertDate(issue.dueAt);
  const resolvedDate = assertDate(issue.resolvedAt);
  const startDate = actualStartDate ?? markerDate;

  if (!startDate || !markerDate) {
    return null;
  }

  const startDayKey = getDayKey(startDate, issue.timezone);
  const markerDayKey = getDayKey(markerDate, issue.timezone);

  if (
    compareDayKeys(markerDayKey, visibleStartDayKey) < 0 ||
    compareDayKeys(startDayKey, visibleEndDayKey) > 0
  ) {
    return null;
  }

  const clippedStartDayKey =
    compareDayKeys(startDayKey, visibleStartDayKey) < 0
      ? visibleStartDayKey
      : startDayKey;
  const clippedEndDayKey =
    compareDayKeys(markerDayKey, visibleEndDayKey) > 0
      ? visibleEndDayKey
      : markerDayKey;

  if (compareDayKeys(clippedEndDayKey, clippedStartDayKey) < 0) {
    return null;
  }

  const displayStartDayKey = findWorkdayInRange(
    clippedStartDayKey,
    1,
    visibleStartDayKey,
    visibleEndDayKey,
  );
  const displayEndDayKey = findWorkdayInRange(
    clippedEndDayKey,
    -1,
    visibleStartDayKey,
    visibleEndDayKey,
  );

  if (!displayStartDayKey && !displayEndDayKey) {
    return null;
  }

  if (
    !displayStartDayKey ||
    !displayEndDayKey ||
    compareDayKeys(displayStartDayKey, displayEndDayKey) > 0
  ) {
    const fallbackDayKey =
      findNearestWorkday(markerDayKey, visibleStartDayKey, visibleEndDayKey) ??
      findNearestWorkday(startDayKey, visibleStartDayKey, visibleEndDayKey);

    if (!fallbackDayKey) {
      return null;
    }

    const column = columnIndex.get(fallbackDayKey);

    if (!column) {
      return null;
    }

    return {
      issueId: issue.id,
      issueKey: issue.key,
      summary: issue.summary,
      issueUrl: issue.issueUrl,
      assigneeName: issue.assigneeName,
      assigneeColor: issue.assigneeColor,
      statusLabel: issue.status,
      isCompleted: issue.isCompleted,
      markerKind: issue.markerKind,
      markerLabel: createMarkerLabel(issue.markerKind, markerDate, issue.timezone),
      createdLabel: createDateLabel("Created", createdDate, issue.timezone),
      startLabel: createStartLabel(actualStartDate, issue.timezone),
      dueLabel: createDateLabel("Due", dueDate, issue.timezone),
      resolvedLabel: createDateLabel("Finished", resolvedDate, issue.timezone),
      estimateHours: issue.estimateHours,
      estimateStoryPoints: issue.estimateStoryPoints,
      observedPeople: issue.observedPeople,
      assigneeHistory: issue.assigneeHistory,
      authorName: issue.authorName,
      pullRequestStatus: issue.pullRequestStatus,
      pullRequestCount: issue.pullRequestCount,
      commitCount: issue.commitCount,
      isMissingDueDate: issue.isMissingDueDate,
      startColumn: column,
      span: 1,
    };
  }

  const startColumn = columnIndex.get(displayStartDayKey);
  const markerColumn = columnIndex.get(displayEndDayKey);

  if (!startColumn || !markerColumn) {
    return null;
  }

  const span = Math.max(1, markerColumn - startColumn + 1);

  return {
    issueId: issue.id,
    issueKey: issue.key,
    summary: issue.summary,
    issueUrl: issue.issueUrl,
    assigneeName: issue.assigneeName,
    assigneeColor: issue.assigneeColor,
    statusLabel: issue.status,
    isCompleted: issue.isCompleted,
    markerKind: issue.markerKind,
    markerLabel: createMarkerLabel(issue.markerKind, markerDate, issue.timezone),
    createdLabel: createDateLabel("Created", createdDate, issue.timezone),
    startLabel: createStartLabel(actualStartDate, issue.timezone),
    dueLabel: createDateLabel("Due", dueDate, issue.timezone),
    resolvedLabel: createDateLabel("Finished", resolvedDate, issue.timezone),
    estimateHours: issue.estimateHours,
    estimateStoryPoints: issue.estimateStoryPoints,
    observedPeople: issue.observedPeople,
    assigneeHistory: issue.assigneeHistory,
    authorName: issue.authorName,
    pullRequestStatus: issue.pullRequestStatus,
    pullRequestCount: issue.pullRequestCount,
    commitCount: issue.commitCount,
    isMissingDueDate: issue.isMissingDueDate,
    startColumn,
    span,
  };
}

function buildRows(
  epics: TimelineEpic[],
  columns: TimelineColumn[],
  visibleStartDayKey: string,
  visibleEndDayKey: string,
): TimelineRow[] {
  const columnIndex = createColumnIndex(columns);

  return epics
    .map((epic) => ({
      componentName: epic.componentName,
      epicId: epic.id,
      epicKey: epic.key,
      epicSummary: epic.summary,
      items: epic.issues
        .map((issue) =>
          buildRowItem(columnIndex, visibleStartDayKey, visibleEndDayKey, issue),
        )
        .filter((item): item is TimelineRowItem => item !== null)
        .sort((left, right) => left.startColumn - right.startColumn),
    }))
    .filter((row) => row.items.length > 0)
    .sort((left, right) => {
      const componentCompare = left.componentName.localeCompare(right.componentName);

      if (componentCompare !== 0) {
        return componentCompare;
      }

      return left.epicKey.localeCompare(right.epicKey);
    });
}

function buildLegend(epics: TimelineEpic[]) {
  const entries = new Map<string, string>();

  for (const epic of epics) {
    for (const issue of epic.issues) {
      for (const personName of issue.observedPeople) {
        if (personName === issue.assigneeName) {
          entries.set(personName, issue.assigneeColor);
          continue;
        }

        if (!entries.has(personName)) {
          entries.set(personName, deriveAssigneeColor(personName));
        }
      }
    }
  }

  return [...entries.entries()]
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName, "ru"))
    .map(([personName, color]) => ({
      personName,
      color,
    }));
}

function collectTimelineTimezones(
  epics: TimelineEpic[],
  options: BuildTimelineOptions,
) {
  return resolveTimezones([
    ...(options.timezones ?? []),
    options.timezone,
    ...epics.flatMap((epic) => epic.issues.map((issue) => issue.timezone)),
  ]);
}

export function buildTimelineModel(
  epics: TimelineEpic[],
  options: BuildTimelineOptions = {},
): TimelineModel {
  const timezones =
    options.resolvedRange?.timezones ?? collectTimelineTimezones(epics, options);
  const resolvedRange =
    options.resolvedRange ??
    resolveTimelineRange(
      {
        timezones,
        rangeStart: options.rangeStart,
        rangeEnd: options.rangeEnd,
        dayWidth: options.dayWidth,
      },
      collectDateBounds(
        epics.flatMap((epic) =>
          epic.issues.flatMap((issue) => [issue.startAt, issue.markerAt].map(assertDate)),
        ),
      ),
    );
  const columns = createColumns(
    resolvedRange.selectedStartDayKey,
    resolvedRange.selectedEndDayKey,
    resolvedRange.todayDayKeys,
  );
  const rows = buildRows(
    epics,
    columns,
    resolvedRange.selectedStartDayKey,
    resolvedRange.selectedEndDayKey,
  );
  const rangeLabelStart = columns[0]?.dayKey ?? resolvedRange.selectedStartDayKey;
  const rangeLabelEnd = columns.at(-1)?.dayKey ?? resolvedRange.selectedEndDayKey;

  return {
    timezones: resolvedRange.timezones,
    columns,
    rows,
    legend: buildLegend(epics),
    rangeLabel: `${formatTimelineDayKey(rangeLabelStart)} - ${formatTimelineDayKey(
      rangeLabelEnd,
    )}`,
    rangeStartInput: resolvedRange.rangeStartInput,
    rangeEndInput: resolvedRange.rangeEndInput,
    dayWidth: resolvedRange.dayWidth,
  };
}
