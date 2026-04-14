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

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  timeZone: "UTC",
});
export const DEFAULT_DAY_WIDTH = 72;
const MIN_DAY_WIDTH = 48;
const MAX_DAY_WIDTH = 240;
const DEFAULT_RANGE_SPAN_IN_DAYS = 15;

type TimelineRangeOptions = {
  rangeStart?: string | null;
  rangeEnd?: string | null;
  dayWidth?: string | number | null;
};

export type TimelineDateBounds = {
  minDate: Date | null;
  maxDate: Date | null;
};

export type TimelineResolvedRange = {
  selectedStart: Date;
  selectedEnd: Date;
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

function floorToDay(value: Date) {
  const floored = new Date(value);
  floored.setUTCHours(0, 0, 0, 0);
  return floored;
}

function dayKey(value: Date) {
  return floorToDay(value).toISOString().slice(0, 10);
}

function isWeekend(value: Date) {
  const day = floorToDay(value).getUTCDay();
  return day === 0 || day === 6;
}

function isWeekStart(value: Date) {
  return floorToDay(value).getUTCDay() === 1;
}

function toWeekLabel(value: Date) {
  return WEEKDAY_FORMATTER.format(value).replace(".", "").toUpperCase();
}

function slotLabel(value: Date) {
  return DATE_FORMATTER.format(value);
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfCurrentWeek(value: Date) {
  const currentDay = floorToDay(value);
  const weekday = currentDay.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;

  return new Date(currentDay.getTime() - daysFromMonday * DAY_IN_MS);
}

function parseDateInput(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(value: Date) {
  return new Date(floorToDay(value).getTime() + DAY_IN_MS - 1);
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

export function getDefaultTimelineRange(now = new Date()) {
  const start = startOfCurrentWeek(now);
  const end = new Date(start.getTime() + DEFAULT_RANGE_SPAN_IN_DAYS * DAY_IN_MS);

  return { start, end };
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
  const defaultRange = getDefaultTimelineRange(now);
  const fallbackMinDate = dataBounds?.minDate ?? now;
  const fallbackMaxDate = dataBounds?.maxDate ?? now;
  const hasCustomRange =
    typeof options.rangeStart === "string" || typeof options.rangeEnd === "string";
  const selectedStart = hasCustomRange
    ? parseDateInput(options.rangeStart) ?? fallbackMinDate
    : defaultRange.start;
  const selectedEndInput = hasCustomRange
    ? options.rangeEnd
      ? endOfDay(parseDateInput(options.rangeEnd) ?? fallbackMaxDate)
      : fallbackMaxDate
    : endOfDay(defaultRange.end);
  const selectedEnd =
    selectedEndInput < selectedStart ? selectedStart : selectedEndInput;

  return {
    selectedStart,
    selectedEnd,
    visibleStart: floorToDay(selectedStart),
    visibleEnd: selectedEnd,
    rangeStartInput: toDateInputValue(selectedStart),
    rangeEndInput: toDateInputValue(selectedEnd),
    dayWidth: normalizeDayWidth(options.dayWidth),
  };
}

function createColumns(minDate: Date, maxDate: Date): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const end = floorToDay(maxDate);
  const todayKey = dayKey(new Date());

  for (let current = floorToDay(minDate); current <= end; ) {
    if (!isWeekend(current)) {
      const isWeekStartColumn = isWeekStart(current);

      columns.push({
        key: current.toISOString(),
        label: slotLabel(current),
        startsAt: current.toISOString(),
        isWeekStart: isWeekStartColumn,
        isToday: dayKey(current) === todayKey,
        weekLabel: isWeekStartColumn ? toWeekLabel(current) : null,
      });
    }

    current = new Date(current.getTime() + DAY_IN_MS);
  }

  return columns;
}

function createColumnIndex(columns: TimelineColumn[]) {
  return new Map(columns.map((column, index) => [dayKey(new Date(column.startsAt)), index + 1]));
}

function findWorkdayInRange(
  value: Date,
  direction: -1 | 1,
  visibleStart: Date,
  visibleEnd: Date,
) {
  const min = floorToDay(visibleStart).getTime();
  const max = floorToDay(visibleEnd).getTime();
  let current = floorToDay(value);

  while (current.getTime() >= min && current.getTime() <= max) {
    if (!isWeekend(current)) {
      return current;
    }

    current = new Date(current.getTime() + direction * DAY_IN_MS);
  }

  return null;
}

function findNearestWorkday(
  value: Date,
  visibleStart: Date,
  visibleEnd: Date,
) {
  const previous = findWorkdayInRange(value, -1, visibleStart, visibleEnd);
  const next = findWorkdayInRange(value, 1, visibleStart, visibleEnd);

  if (previous && next) {
    return value.getTime() - previous.getTime() <= next.getTime() - value.getTime()
      ? previous
      : next;
  }

  return previous ?? next;
}

function createMarkerLabel(kind: TimelineMarkerKind, value: Date | null) {
  if (!value) {
    return "No due or done date";
  }

  const prefix =
    kind === "DONE" ? "Done" : kind === "DUE" ? "Due" : "Observed";

  return `${prefix} · ${DATE_FORMATTER.format(value)}`;
}

function createDateLabel(prefix: string, value: Date | null) {
  if (!value) {
    return null;
  }

  return `${prefix} · ${DATE_FORMATTER.format(value)}`;
}

function createStartLabel(value: Date | null) {
  return createDateLabel("Started", value);
}

function buildRowItem(
  columnIndex: Map<string, number>,
  visibleStart: Date,
  visibleEnd: Date,
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

  if (markerDate < visibleStart || startDate > visibleEnd) {
    return null;
  }

  const clippedStart = startDate < visibleStart ? visibleStart : startDate;
  const clippedEnd = markerDate > visibleEnd ? visibleEnd : markerDate;

  if (clippedEnd < visibleStart || clippedStart > visibleEnd) {
    return null;
  }

  const displayStart = findWorkdayInRange(clippedStart, 1, visibleStart, visibleEnd);
  const displayEnd = findWorkdayInRange(clippedEnd, -1, visibleStart, visibleEnd);

  if (!displayStart && !displayEnd) {
    return null;
  }

  if (
    !displayStart ||
    !displayEnd ||
    displayStart.getTime() > displayEnd.getTime()
  ) {
    const fallbackDate =
      findNearestWorkday(markerDate, visibleStart, visibleEnd) ??
      findNearestWorkday(startDate, visibleStart, visibleEnd);

    if (!fallbackDate) {
      return null;
    }

    const column = columnIndex.get(dayKey(fallbackDate));

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
      markerLabel: createMarkerLabel(issue.markerKind, markerDate),
      createdLabel: createDateLabel("Created", createdDate),
      startLabel: createStartLabel(actualStartDate),
      dueLabel: createDateLabel("Due", dueDate),
      resolvedLabel: createDateLabel("Finished", resolvedDate),
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

  const startColumn = columnIndex.get(dayKey(displayStart));
  const markerColumn = columnIndex.get(dayKey(displayEnd));

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
    markerLabel: createMarkerLabel(issue.markerKind, markerDate),
    createdLabel: createDateLabel("Created", createdDate),
    startLabel: createStartLabel(actualStartDate),
    dueLabel: createDateLabel("Due", dueDate),
    resolvedLabel: createDateLabel("Finished", resolvedDate),
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
  visibleStart: Date,
  visibleEnd: Date,
): TimelineRow[] {
  const columnIndex = createColumnIndex(columns);

  return epics
    .map((epic) => ({
      componentName: epic.componentName,
      epicId: epic.id,
      epicKey: epic.key,
      epicSummary: epic.summary,
      items: epic.issues
        .map((issue) => buildRowItem(columnIndex, visibleStart, visibleEnd, issue))
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

export function buildTimelineModel(
  epics: TimelineEpic[],
  options: BuildTimelineOptions = {},
): TimelineModel {
  const resolvedRange =
    options.resolvedRange ??
    resolveTimelineRange(
      {
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
    resolvedRange.selectedStart,
    resolvedRange.selectedEnd,
  );
  const rows = buildRows(
    epics,
    columns,
    resolvedRange.visibleStart,
    resolvedRange.visibleEnd,
  );
  const rangeLabelStart = columns[0]?.startsAt
    ? new Date(columns[0].startsAt)
    : floorToDay(resolvedRange.selectedStart);
  const rangeLabelEnd = columns.at(-1)?.startsAt
    ? new Date(columns.at(-1)!.startsAt)
    : floorToDay(resolvedRange.selectedEnd);

  return {
    columns,
    rows,
    legend: buildLegend(epics),
    rangeLabel: `${DATE_FORMATTER.format(rangeLabelStart)} - ${DATE_FORMATTER.format(
      rangeLabelEnd,
    )}`,
    rangeStartInput: resolvedRange.rangeStartInput,
    rangeEndInput: resolvedRange.rangeEndInput,
    dayWidth: resolvedRange.dayWidth,
  };
}
