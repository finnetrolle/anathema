"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { AppLocale } from "@/modules/i18n/config";
import { getRiskLevelLabel, type RiskLevel } from "@/modules/timeline/risk-helpers";
import type { TimelineModel, TimelineRowItem } from "@/modules/timeline/types";

type TimelineBoardProps = {
  timeline: TimelineModel;
  locale: AppLocale;
};

type SelectedTask = {
  anchorTaskId: string;
  epicKey: string;
  epicSummary: string;
  item: TimelineRowItem;
};

const POPOVER_MARGIN = 16;
const POPOVER_GAP = 12;
const CENTER_POPOVER_BREAKPOINT = 1180;

const COPY: Record<
  AppLocale,
  {
    noEstimate: string;
    mergedPrs: (count: number) => string;
    openPrs: (count: number) => string;
    declinedPrs: (count: number) => string;
    linkedPrs: (count: number) => string;
    commits: (count: number) => string;
    noCodeActivity: string;
    noWorkingDays: string;
    noTasksForPerson: (person: string) => string;
    noTasksInRange: string;
    showAll: string;
    gridHeader: string;
    tasksInLane: (count: number) => string;
    taskDetails: string;
    openInJira: string;
    closeTaskDetails: string;
    close: string;
    epic: string;
    component: string;
    epicComponent: string;
    assignee: string;
    status: string;
    created: string;
    started: string;
    dueDate: string;
    estimate: string;
    finished: string;
    assigneeHistory: string;
    author: string;
    pullRequests: string;
    commitsLabel: string;
    dateNotAvailable: string;
    startNotObserved: string;
    noDueDate: string;
    notCompleted: string;
    noAssigneesObserved: string;
    authorNotAvailable: string;
    riskFactor: string;
    riskDrivers: string;
    noRiskFactors: string;
    riskUnavailable: string;
    riskCardLabel: (score: number | null, levelLabel: string) => string;
    attention: string;
    missingDueDateWarning: string;
  }
> = {
  ru: {
    noEstimate: "Без оценки",
    mergedPrs: (count) => `Смерженные PR: ${count}`,
    openPrs: (count) => `Открытые PR: ${count}`,
    declinedPrs: (count) => `Отклонённые PR: ${count}`,
    linkedPrs: (count) => `Связанные PR: ${count}`,
    commits: (count) => `Коммиты: ${count}`,
    noCodeActivity: "Нет коммитов или pull request",
    noWorkingDays: "В выбранном диапазоне нет рабочих дней.",
    noTasksForPerson: (person) =>
      `В выбранном диапазоне таймлайна нет задач, связанных с ${person}.`,
    noTasksInRange: "В выбранный диапазон таймлайна не попадает ни одна задача.",
    showAll: "Показать всё",
    gridHeader: "Эпик / Работа",
    tasksInLane: (count) => `${count} задач в дорожке`,
    taskDetails: "Детали задачи",
    openInJira: "Открыть в Jira",
    closeTaskDetails: "Закрыть детали задачи",
    close: "Закрыть",
    epic: "Эпик",
    component: "Компонент",
    epicComponent: "Компонент эпика",
    assignee: "Исполнитель",
    status: "Статус",
    created: "Создано",
    started: "Старт",
    dueDate: "Срок",
    estimate: "Оценка",
    finished: "Завершено",
    assigneeHistory: "История исполнителей",
    author: "Автор",
    pullRequests: "Pull request",
    commitsLabel: "Коммиты",
    dateNotAvailable: "Дата недоступна",
    startNotObserved: "Старт не зафиксирован",
    noDueDate: "Срок не указан",
    notCompleted: "Не завершена",
    noAssigneesObserved: "Исполнители не зафиксированы",
    authorNotAvailable: "Автор недоступен",
    riskFactor: "Риск-фактор",
    riskDrivers: "Факторы риска",
    noRiskFactors: "Для задачи не сохранены факторы риска.",
    riskUnavailable: "Риск не посчитан",
    riskCardLabel: (score, levelLabel) =>
      score === null ? "Риск не посчитан" : `Риск-фактор: ${score} (${levelLabel})`,
    attention: "Внимание",
    missingDueDateWarning: "Задача в работе, но у неё отсутствует срок.",
  },
  en: {
    noEstimate: "No estimate",
    mergedPrs: (count) => `Merged PR${count > 1 ? "s" : ""}: ${count}`,
    openPrs: (count) => `Open PR${count > 1 ? "s" : ""}: ${count}`,
    declinedPrs: (count) => `Declined PR${count > 1 ? "s" : ""}: ${count}`,
    linkedPrs: (count) => `Linked PR${count > 1 ? "s" : ""}: ${count}`,
    commits: (count) => `Commits: ${count}`,
    noCodeActivity: "No commits or pull requests",
    noWorkingDays: "Selected range contains no working days.",
    noTasksForPerson: (person) =>
      `No tasks related to ${person} in the selected timeline range.`,
    noTasksInRange: "No tasks intersect the selected timeline range.",
    showAll: "Show all",
    gridHeader: "Epic / Work",
    tasksInLane: (count) => `${count} tasks in lane`,
    taskDetails: "Task details",
    openInJira: "Open in Jira",
    closeTaskDetails: "Close task details",
    close: "Close",
    epic: "Epic",
    component: "Component",
    epicComponent: "Epic component",
    assignee: "Assignee",
    status: "Status",
    created: "Created",
    started: "Started",
    dueDate: "Due date",
    estimate: "Estimate",
    finished: "Finished",
    assigneeHistory: "Assignee history",
    author: "Author",
    pullRequests: "Pull requests",
    commitsLabel: "Commits",
    dateNotAvailable: "Date not available",
    startNotObserved: "Start not observed",
    noDueDate: "No due date",
    notCompleted: "Not completed",
    noAssigneesObserved: "No assignees observed",
    authorNotAvailable: "Author not available",
    riskFactor: "Risk factor",
    riskDrivers: "Risk factors",
    noRiskFactors: "No risk factors were stored for this task.",
    riskUnavailable: "Risk not computed",
    riskCardLabel: (score, levelLabel) =>
      score === null ? "Risk not computed" : `Risk factor: ${score} (${levelLabel})`,
    attention: "Attention",
    missingDueDateWarning: "Task is in progress, but due date is missing.",
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function joinClassNames(...classNames: Array<string | false>) {
  return classNames.filter(Boolean).join(" ");
}

function buildCenteredPopoverStyle() {
  return {
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  } satisfies CSSProperties;
}

function groupRowsByComponent(rows: TimelineModel["rows"]) {
  const groups = new Map<string, TimelineModel["rows"]>();

  for (const row of rows) {
    const existingRows = groups.get(row.componentName);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    groups.set(row.componentName, [row]);
  }

  return [...groups.entries()].map(([componentName, componentRows]) => ({
    componentName,
    rows: componentRows,
  }));
}

function formatEstimateValue(value: number, unit: string) {
  const formattedValue =
    Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");

  return `${formattedValue} ${unit}`;
}

function formatEstimateLabel(item: TimelineRowItem, locale: AppLocale) {
  const parts = [
    item.estimateHours === null
      ? null
      : formatEstimateValue(item.estimateHours, "h"),
    item.estimateStoryPoints === null
      ? null
      : formatEstimateValue(item.estimateStoryPoints, "SP"),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : COPY[locale].noEstimate;
}

function formatDevelopmentIndicatorLabel(item: TimelineRowItem, locale: AppLocale) {
  const copy = COPY[locale];

  if (item.pullRequestCount > 0) {
    if (item.pullRequestStatus === "MERGED") {
      return copy.mergedPrs(item.pullRequestCount);
    }

    if (item.pullRequestStatus === "OPEN") {
      return copy.openPrs(item.pullRequestCount);
    }

    if (item.pullRequestStatus === "DECLINED") {
      return copy.declinedPrs(item.pullRequestCount);
    }

    return copy.linkedPrs(item.pullRequestCount);
  }

  if (item.commitCount > 0) {
    return copy.commits(item.commitCount);
  }

  return copy.noCodeActivity;
}

function buildRiskLevelClass(level: RiskLevel) {
  return `risk-level risk-level--${level.toLowerCase()}`;
}

function formatRiskIndicatorLabel(item: TimelineRowItem, locale: AppLocale) {
  const copy = COPY[locale];
  const levelLabel =
    item.riskLevel === null ? copy.riskUnavailable : getRiskLevelLabel(item.riskLevel, locale);

  return copy.riskCardLabel(item.riskScore, levelLabel);
}

function TaskCardRiskIndicator({
  item,
  locale,
}: {
  item: TimelineRowItem;
  locale: AppLocale;
}) {
  const label = formatRiskIndicatorLabel(item, locale);

  return (
    <span
      aria-label={label}
      className={joinClassNames(
        "task-card__risk-indicator",
        item.riskLevel
          ? `task-card__risk-indicator--${item.riskLevel.toLowerCase()}`
          : "task-card__risk-indicator--empty",
      )}
      title={label}
    >
      {item.riskScore ?? "—"}
    </span>
  );
}

function TaskRiskReasonCards({
  item,
  locale,
}: {
  item: TimelineRowItem;
  locale: AppLocale;
}) {
  const copy = COPY[locale];

  return (
    <div className="risk-reason-block risk-reason-block--embedded">
      <p className="risk-reason-block__title">{copy.riskDrivers}</p>

      {item.riskReasons.length === 0 ? (
        <div className="empty-note">{copy.noRiskFactors}</div>
      ) : (
        <div className="risk-reason-list">
          {item.riskReasons.map((reason) => (
            <article className="risk-reason-card" key={`${item.issueId}:${reason.reasonCode}`}>
              <div className="risk-reason-card__header">
                <strong>{reason.title}</strong>
                <span>+{reason.weight}</span>
              </div>
              <p>{reason.narrative}</p>
              <div className="risk-reason-card__action">{reason.recommendedAction}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCardDevelopmentIndicator({
  item,
  locale,
}: {
  item: TimelineRowItem;
  locale: AppLocale;
}) {
  const label = formatDevelopmentIndicatorLabel(item, locale);

  if (item.pullRequestCount > 0) {
    return (
      <span
        aria-label={label}
        className={joinClassNames(
          "task-card__development-indicator",
          "task-card__development-indicator--pr",
          item.pullRequestStatus === "MERGED" &&
            "task-card__development-indicator--pr-merged",
        )}
        title={label}
      >
        <span aria-hidden="true" className="task-card__development-dot" />
      </span>
    );
  }

  return (
    <span
      aria-label={label}
      className={joinClassNames(
        "task-card__development-indicator",
        item.commitCount > 0
          ? "task-card__development-indicator--commits"
          : "task-card__development-indicator--empty",
      )}
      title={label}
    >
      {item.commitCount > 0 ? item.commitCount : "!"}
    </span>
  );
}

export function TimelineBoard({ timeline, locale }: TimelineBoardProps) {
  const copy = COPY[locale];
  const columnCount = Math.max(1, timeline.columns.length);
  const [activePerson, setActivePerson] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>(
    buildCenteredPopoverStyle(),
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const assigneesWithTasksInRange = new Set(
    timeline.rows.flatMap((row) => row.items.map((item) => item.assigneeName)),
  );
  const visibleRows = timeline.rows
    .map((row) => ({
      ...row,
      items: activePerson
        ? row.items.filter((item) => item.observedPeople.includes(activePerson))
        : row.items,
    }))
    .filter((row) => row.items.length > 0);
  const visibleComponents = groupRowsByComponent(visibleRows);

  useEffect(() => {
    if (!selectedTask) {
      return undefined;
    }

    const anchorSelector = `[data-task-trigger="${selectedTask.anchorTaskId}"]`;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTask(null);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (popoverRef.current?.contains(target)) {
        return;
      }

      const anchor = document.querySelector(anchorSelector);

      if (anchor instanceof Node && anchor.contains(target)) {
        return;
      }

      setSelectedTask(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return undefined;
    }

    const isTaskVisible = visibleRows.some((row) =>
      row.items.some((item) => item.issueId === selectedTask.item.issueId),
    );

    if (!isTaskVisible) {
      const frame = window.requestAnimationFrame(() => {
        setSelectedTask(null);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    return undefined;
  }, [selectedTask, visibleRows]);

  useLayoutEffect(() => {
    if (!selectedTask || !popoverRef.current) {
      return undefined;
    }

    const updatePosition = () => {
      if (!popoverRef.current) {
        return;
      }

      const anchor = document.querySelector(
        `[data-task-trigger="${selectedTask.anchorTaskId}"]`,
      );
      const popoverRect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (!(anchor instanceof HTMLElement) || viewportWidth < CENTER_POPOVER_BREAKPOINT) {
        setPopoverStyle(buildCenteredPopoverStyle());
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const maxLeft = viewportWidth - popoverRect.width - POPOVER_MARGIN;
      const maxTop = viewportHeight - popoverRect.height - POPOVER_MARGIN;
      let left = anchorRect.right + POPOVER_GAP;
      let top = anchorRect.top;

      if (left > maxLeft) {
        left = anchorRect.left - popoverRect.width - POPOVER_GAP;
      }

      if (left < POPOVER_MARGIN) {
        left = clamp(anchorRect.left, POPOVER_MARGIN, maxLeft);
        top = anchorRect.bottom + POPOVER_GAP;
      }

      if (top > maxTop) {
        top = anchorRect.bottom - popoverRect.height;
      }

      if (top < POPOVER_MARGIN) {
        top = clamp(anchorRect.top, POPOVER_MARGIN, maxTop);
      }

      setPopoverStyle({
        left: `${clamp(left, POPOVER_MARGIN, maxLeft)}px`,
        top: `${clamp(top, POPOVER_MARGIN, maxTop)}px`,
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [selectedTask]);

  return (
    <div className="timeline-board">
      {timeline.columns.length === 0 ? (
        <div className="timeline-board__empty">
          {copy.noWorkingDays}
        </div>
      ) : null}

      {timeline.columns.length > 0 && visibleRows.length === 0 ? (
        <div className="timeline-board__empty">
          {activePerson
            ? copy.noTasksForPerson(activePerson)
            : copy.noTasksInRange}
        </div>
      ) : null}

      <div className="timeline-board__legend">
        {activePerson ? (
          <button
            className="legend-item legend-item--button legend-item--reset"
            onClick={() => setActivePerson(null)}
            type="button"
          >
            <span>{copy.showAll}</span>
          </button>
        ) : null}

        {timeline.legend.map((entry) => {
          const hasAssigneeTasksInRange = assigneesWithTasksInRange.has(
            entry.personName,
          );

          return (
            <button
              aria-pressed={activePerson === entry.personName}
              className={joinClassNames(
                "legend-item",
                "legend-item--button",
                activePerson === entry.personName
                  ? hasAssigneeTasksInRange
                    ? "legend-item--active"
                    : "legend-item--empty"
                  : activePerson
                    ? "legend-item--inactive"
                    : false,
                !hasAssigneeTasksInRange && "legend-item--empty",
              )}
              key={entry.personName}
              onClick={() =>
                setActivePerson((current) =>
                  current === entry.personName ? null : entry.personName,
                )
              }
              type="button"
            >
              <span
                className="legend-item__swatch"
                style={{ backgroundColor: entry.color }}
              />
              <span>{entry.personName}</span>
            </button>
          );
        })}
      </div>

      <div className="timeline-grid">
        <div
          className="timeline-grid__canvas"
          style={
            {
              "--timeline-columns": columnCount,
              "--timeline-day-width": `${timeline.dayWidth}px`,
            } as CSSProperties
          }
        >
          <div className="timeline-grid__header">
            <div className="timeline-grid__header-label">{copy.gridHeader}</div>

            <div className="timeline-grid__header-track">
              {timeline.columns.map((column) => (
                <div
                  className={joinClassNames(
                    "timeline-grid__slot",
                    column.isWeekStart && "timeline-grid__slot--week-start",
                    column.isToday && "timeline-grid__slot--today",
                  )}
                  key={column.key}
                >
                  {column.weekLabel ? (
                    <span className="timeline-grid__slot-week-label">
                      {column.weekLabel}
                    </span>
                  ) : null}
                  <span>{column.label}</span>
                </div>
              ))}
            </div>
          </div>

          {visibleComponents.map((componentGroup) => (
            <section
              className="timeline-component"
              key={componentGroup.componentName}
            >
              <div className="timeline-component__header">
                <h3>{componentGroup.componentName}</h3>
              </div>

              {componentGroup.rows.map((row) => (
                <div className="timeline-row" key={row.epicId}>
                  <div className="timeline-row__label">
                    <h3>
                      {row.epicKey} · {row.epicSummary}
                    </h3>
                    <p className="row-subtitle">
                      {copy.tasksInLane(row.items.length)}
                    </p>
                  </div>

                  <div className="timeline-row__lane">
                    <div className="timeline-row__day-markers" aria-hidden="true">
                      {timeline.columns.map((column, index) =>
                        column.isWeekStart || column.isToday ? (
                          <span
                            className={joinClassNames(
                              "timeline-row__day-marker",
                              column.isWeekStart &&
                                "timeline-row__day-marker--week-start",
                              column.isToday && "timeline-row__day-marker--today",
                            )}
                            key={`${row.epicId}-${column.key}`}
                            style={{ gridColumn: `${index + 1}` }}
                          />
                        ) : null,
                      )}
                    </div>

                    {row.items.map((item) => (
                      <button
                        aria-haspopup="dialog"
                        aria-expanded={selectedTask?.item.issueId === item.issueId}
                        className={
                          item.isMissingDueDate
                            ? "task-card task-card--missing-due"
                            : item.isCompleted
                              ? "task-card task-card--done"
                              : "task-card task-card--open"
                        }
                        data-task-trigger={item.issueId}
                        key={item.issueId}
                        onClick={() => {
                          setSelectedTask((current) =>
                            current?.item.issueId === item.issueId
                              ? null
                              : {
                                  anchorTaskId: item.issueId,
                                  epicKey: row.epicKey,
                                  epicSummary: row.epicSummary,
                                  item,
                                },
                          );
                        }}
                        style={
                          {
                            "--task-color": item.assigneeColor,
                            gridColumn: `${item.startColumn} / span ${item.span}`,
                          } as CSSProperties
                        }
                        type="button"
                      >
                        <div className="task-card__meta">
                          <span className="task-card__key">{item.issueKey}</span>
                          <div className="task-card__signals">
                            <TaskCardRiskIndicator item={item} locale={locale} />
                            <TaskCardDevelopmentIndicator item={item} locale={locale} />
                          </div>
                        </div>
                        <strong className="task-card__title">{item.summary}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>

      {selectedTask && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-labelledby="task-dialog-title"
              className="task-popover"
              ref={popoverRef}
              role="dialog"
              style={popoverStyle}
            >
              <div className="task-dialog__header">
                <div>
                  <span className="eyebrow">{copy.taskDetails}</span>
                  <h3 id="task-dialog-title">{selectedTask.item.issueKey}</h3>
                </div>

                <div className="task-dialog__actions">
                  {selectedTask.item.issueUrl ? (
                    <a
                      className="task-dialog__link"
                      href={selectedTask.item.issueUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {copy.openInJira}
                    </a>
                  ) : null}

                  <button
                    aria-label={copy.closeTaskDetails}
                    className="task-dialog__close"
                    onClick={() => setSelectedTask(null)}
                    type="button"
                  >
                    {copy.close}
                  </button>
                </div>
              </div>

              <p className="task-dialog__summary">{selectedTask.item.summary}</p>

              <div className="task-dialog__content">
                <div className="task-dialog__table-wrap">
                  <table className="task-dialog__table">
                    <tbody>
                      <tr>
                        <th scope="row">{copy.epic}</th>
                        <td>
                          {selectedTask.epicKey} · {selectedTask.epicSummary}
                        </td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.epicComponent}</th>
                        <td>{selectedTask.item.epicComponentName}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.component}</th>
                        <td>{selectedTask.item.componentName}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.assignee}</th>
                        <td>
                          <span className="task-dialog__assignee">
                            <span
                              className="task-dialog__swatch"
                              style={
                                {
                                  backgroundColor: selectedTask.item.assigneeColor,
                                } as CSSProperties
                              }
                            />
                            {selectedTask.item.assigneeName}
                          </span>
                        </td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.status}</th>
                        <td>{selectedTask.item.statusLabel}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.created}</th>
                        <td>{selectedTask.item.createdLabel ?? copy.dateNotAvailable}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.started}</th>
                        <td>{selectedTask.item.startLabel ?? copy.startNotObserved}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.dueDate}</th>
                        <td>{selectedTask.item.dueLabel ?? copy.noDueDate}</td>
                      </tr>

                      <tr
                        className={
                          !selectedTask.item.isCompleted &&
                          selectedTask.item.estimateHours === null &&
                          selectedTask.item.estimateStoryPoints === null
                            ? "task-dialog__row--alert"
                            : undefined
                        }
                      >
                        <th scope="row">{copy.estimate}</th>
                        <td>{formatEstimateLabel(selectedTask.item, locale)}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.finished}</th>
                        <td>{selectedTask.item.resolvedLabel ?? copy.notCompleted}</td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.assigneeHistory}</th>
                        <td>
                          {selectedTask.item.assigneeHistory.length > 0
                            ? selectedTask.item.assigneeHistory.join(", ")
                            : copy.noAssigneesObserved}
                        </td>
                      </tr>

                      <tr>
                        <th scope="row">{copy.author}</th>
                        <td>{selectedTask.item.authorName ?? copy.authorNotAvailable}</td>
                      </tr>

                      <tr
                        className={
                          selectedTask.item.isCompleted &&
                          selectedTask.item.pullRequestCount === 0
                            ? "task-dialog__row--alert"
                            : undefined
                        }
                      >
                        <th scope="row">{copy.pullRequests}</th>
                        <td>{selectedTask.item.pullRequestCount}</td>
                      </tr>

                      <tr
                        className={
                          !selectedTask.item.isCompleted &&
                          selectedTask.item.commitCount === 0
                            ? "task-dialog__row--alert"
                            : undefined
                        }
                      >
                        <th scope="row">{copy.commitsLabel}</th>
                        <td>{selectedTask.item.commitCount}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <aside className="task-dialog__risk">
                  <div className="task-dialog__risk-summary">
                    <p className="task-dialog__risk-label">{copy.riskFactor}</p>
                    <div className="task-dialog__risk-score">
                      {selectedTask.item.riskLevel ? (
                        <span className={buildRiskLevelClass(selectedTask.item.riskLevel)}>
                          {getRiskLevelLabel(selectedTask.item.riskLevel, locale)}
                        </span>
                      ) : null}
                      <strong>{selectedTask.item.riskScore ?? "—"}</strong>
                    </div>
                  </div>

                  <TaskRiskReasonCards item={selectedTask.item} locale={locale} />
                </aside>
              </div>

              {selectedTask.item.isMissingDueDate ? (
                <div className="task-dialog__field task-dialog__field--warning">
                  <span>{copy.attention}</span>
                  <strong>{copy.missingDueDateWarning}</strong>
                </div>
              ) : null}
        </div>,
        document.body,
          )
        : null}
    </div>
  );
}
