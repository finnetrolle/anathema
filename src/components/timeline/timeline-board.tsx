"use client";

import { useState, type CSSProperties } from "react";

import type { AppLocale } from "@/modules/i18n/config";
import type { TimelineModel } from "@/modules/timeline/types";
import {
  COPY,
  formatDevelopmentIndicatorLabel,
  formatRiskIndicatorLabel,
  groupRowsByComponent,
  joinClassNames,
} from "@/components/timeline/timeline-copy";
import { useTaskSelection } from "@/components/timeline/use-task-selection";
import { TaskDetailDialog } from "@/components/timeline/task-detail-dialog";
import { TimelineLegend } from "@/components/timeline/timeline-legend";

type TimelineBoardProps = {
  timeline: TimelineModel;
  locale: AppLocale;
};

function TaskCardRiskIndicator({
  item,
  locale,
}: {
  item: TimelineModel["rows"][number]["items"][number];
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

function TaskCardDevelopmentIndicator({
  item,
  locale,
}: {
  item: TimelineModel["rows"][number]["items"][number];
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

  const { selectedTask, setSelectedTask, popoverRef, popoverStyle } =
    useTaskSelection(visibleRows);

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

      <TimelineLegend
        legend={timeline.legend}
        activePerson={activePerson}
        setActivePerson={setActivePerson}
        assigneesWithTasksInRange={assigneesWithTasksInRange}
        locale={locale}
      />

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

      {selectedTask && typeof document !== "undefined" ? (
        <TaskDetailDialog
          selectedTask={selectedTask}
          popoverRef={popoverRef}
          popoverStyle={popoverStyle}
          locale={locale}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
    </div>
  );
}
