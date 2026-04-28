import type {
  TimelineColumn,
  TimelineEpic,
  TimelineIssue,
  TimelineMarkerKind,
  TimelineModel,
  TimelineRow,
  TimelineRowItem,
} from "@/modules/timeline/types";
import {
  DEFAULT_APP_LOCALE,
  type AppLocale,
} from "@/modules/i18n/config";
import { deriveAssigneeColor } from "@/modules/jira/derive";
import {
  addDaysToDayKey,
  compareDayKeys,
  formatTimelineDate,
  formatTimelineDayKey,
  getDayKeyDistance,
  isWeekendDayKey,
} from "@/modules/timeline/date-helpers";
import { resolveTimelineTaskBounds } from "@/modules/timeline/task-bounds";
import {
  type TimelineRangeOptions,
  type TimelineDateBounds,
  type TimelineResolvedRange,
  resolveTimezones,
  resolveTimelineRange,
  createColumns,
  createColumnIndex,
} from "@/modules/timeline/timeline-range";

export type { TimelineDateBounds, TimelineResolvedRange };
export { getDefaultTimelineRange, normalizeDayWidth, resolveTimelineRange } from "./timeline-range";

type BuildTimelineOptions = TimelineRangeOptions & {
  locale?: AppLocale;
  resolvedRange?: TimelineResolvedRange;
  now?: Date;
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
  locale: AppLocale,
) {
  if (!value) {
    return locale === "ru" ? "Нет даты срока или завершения" : "No due or done date";
  }

  const prefix =
    kind === "DONE"
      ? locale === "ru"
        ? "Готово"
        : "Done"
      : kind === "DUE"
        ? locale === "ru"
          ? "Срок"
          : "Due"
        : locale === "ru"
          ? "Зафиксировано"
          : "Observed";

  return `${prefix} · ${formatTimelineDate(value, timezone, locale)}`;
}

function createDateLabel(
  prefix: string,
  value: Date | null,
  timezone: string,
  locale: AppLocale,
) {
  if (!value) {
    return null;
  }

  return `${prefix} · ${formatTimelineDate(value, timezone, locale)}`;
}

function createStartLabel(
  value: Date | null,
  timezone: string,
  locale: AppLocale,
) {
  return createDateLabel(locale === "ru" ? "Старт" : "Started", value, timezone, locale);
}

function resolveIssueDates(issue: TimelineIssue, now?: Date) {
  const markerDate = assertDate(issue.markerAt);
  const createdDate = assertDate(issue.createdAt);
  const actualStartDate = assertDate(issue.startAt);
  const dueDate = assertDate(issue.dueAt);
  const resolvedDate = assertDate(issue.resolvedAt);

  return {
    markerDate,
    createdDate,
    actualStartDate,
    dueDate,
    resolvedDate,
    bounds: resolveTimelineTaskBounds({
      timezone: issue.timezone,
      startAt: actualStartDate,
      dueAt: dueDate,
      markerAt: markerDate,
      markerKind: issue.markerKind,
      estimateHours: issue.estimateHours,
      now,
    }),
  };
}

function buildRowItem(
  columnIndex: Map<string, number>,
  visibleStartDayKey: string,
  visibleEndDayKey: string,
  issue: TimelineIssue,
  epicComponentName: string,
  locale: AppLocale,
  now?: Date,
): TimelineRowItem | null {
  const { markerDate, createdDate, actualStartDate, dueDate, resolvedDate, bounds } =
    resolveIssueDates(issue, now);
  const startDayKey = bounds.startDayKey;
  const markerDayKey = bounds.endDayKey;

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

  const base = {
    issueId: issue.id,
    issueKey: issue.key,
    summary: issue.summary,
    issueUrl: issue.issueUrl,
    componentName: issue.componentName,
    assigneeName: issue.assigneeName,
    assigneeColor: issue.assigneeColor,
    statusLabel: issue.status,
    isCompleted: issue.isCompleted,
    markerKind: issue.markerKind,
    markerLabel: createMarkerLabel(issue.markerKind, markerDate, issue.timezone, locale),
    createdLabel: createDateLabel(
      locale === "ru" ? "Создано" : "Created",
      createdDate,
      issue.timezone,
      locale,
    ),
    startLabel: createStartLabel(actualStartDate, issue.timezone, locale),
    dueLabel: createDateLabel(
      locale === "ru" ? "Срок" : "Due",
      dueDate,
      issue.timezone,
      locale,
    ),
    resolvedLabel: createDateLabel(
      locale === "ru" ? "Завершено" : "Finished",
      resolvedDate,
      issue.timezone,
      locale,
    ),
    estimateHours: issue.estimateHours,
    estimateStoryPoints: issue.estimateStoryPoints,
    observedPeople: issue.observedPeople,
    assigneeHistory: issue.assigneeHistory,
    authorName: issue.authorName,
    pullRequestStatus: issue.pullRequestStatus,
    pullRequestCount: issue.pullRequestCount,
    commitCount: issue.commitCount,
    epicComponentName,
    isMissingDueDate: issue.isMissingDueDate,
    riskScore: issue.riskScore,
    riskLevel: issue.riskLevel,
    riskReasons: issue.riskReasons,
  };

  if (
    !displayStartDayKey ||
    !displayEndDayKey ||
    compareDayKeys(displayStartDayKey, displayEndDayKey) > 0
  ) {
    const fallbackDayKey =
      findNearestWorkday(markerDayKey, visibleStartDayKey, visibleEndDayKey) ??
      findNearestWorkday(startDayKey, visibleStartDayKey, visibleEndDayKey);

    const column = fallbackDayKey ? columnIndex.get(fallbackDayKey) : undefined;

    if (!column) {
      return null;
    }

    return { ...base, startColumn: column, span: 1 };
  }

  const startColumn = columnIndex.get(displayStartDayKey);
  const markerColumn = columnIndex.get(displayEndDayKey);

  if (!startColumn || !markerColumn) {
    return null;
  }

  const span = Math.max(1, markerColumn - startColumn + 1);

  return { ...base, startColumn, span };
}

function buildRows(
  epics: TimelineEpic[],
  columns: TimelineColumn[],
  visibleStartDayKey: string,
  visibleEndDayKey: string,
  locale: AppLocale,
  now?: Date,
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
          buildRowItem(
            columnIndex,
            visibleStartDayKey,
            visibleEndDayKey,
            issue,
            epic.componentName,
            locale,
            now,
          ),
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
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
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
          epic.issues.flatMap((issue) => {
            const { bounds } = resolveIssueDates(issue, options.now);

            return [bounds.startDate, bounds.endDate];
          }),
        ),
      ),
      options.now,
    );
  const columns = createColumns(
    resolvedRange.selectedStartDayKey,
    resolvedRange.selectedEndDayKey,
    resolvedRange.todayDayKeys,
    locale,
  );
  const rows = buildRows(
    epics,
    columns,
    resolvedRange.selectedStartDayKey,
    resolvedRange.selectedEndDayKey,
    locale,
    options.now,
  );
  const rangeLabelStart = columns[0]?.dayKey ?? resolvedRange.selectedStartDayKey;
  const rangeLabelEnd = columns.at(-1)?.dayKey ?? resolvedRange.selectedEndDayKey;

  return {
    timezones: resolvedRange.timezones,
    columns,
    rows,
    legend: buildLegend(epics),
    rangeLabel: `${formatTimelineDayKey(rangeLabelStart, locale)} - ${formatTimelineDayKey(
      rangeLabelEnd,
      locale,
    )}`,
    rangeStartInput: resolvedRange.rangeStartInput,
    rangeEndInput: resolvedRange.rangeEndInput,
    dayWidth: resolvedRange.dayWidth,
  };
}
