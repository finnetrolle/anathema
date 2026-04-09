"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { TimelineModel, TimelineRowItem } from "@/modules/timeline/types";

type TimelineBoardProps = {
  timeline: TimelineModel;
};

type SelectedTask = {
  anchorTaskId: string;
  epicKey: string;
  epicSummary: string;
  item: TimelineRowItem;
};

const POPOVER_MARGIN = 16;
const POPOVER_GAP = 12;
const CENTER_POPOVER_BREAKPOINT = 920;

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

function formatEstimateLabel(item: TimelineRowItem) {
  const parts = [
    item.estimateHours === null
      ? null
      : formatEstimateValue(item.estimateHours, "h"),
    item.estimateStoryPoints === null
      ? null
      : formatEstimateValue(item.estimateStoryPoints, "SP"),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : "No estimate";
}

function formatDevelopmentIndicatorLabel(item: TimelineRowItem) {
  if (item.pullRequestCount > 0) {
    if (item.pullRequestStatus === "MERGED") {
      return `Merged PR${item.pullRequestCount > 1 ? "s" : ""}: ${item.pullRequestCount}`;
    }

    if (item.pullRequestStatus === "OPEN") {
      return `Open PR${item.pullRequestCount > 1 ? "s" : ""}: ${item.pullRequestCount}`;
    }

    if (item.pullRequestStatus === "DECLINED") {
      return `Declined PR${item.pullRequestCount > 1 ? "s" : ""}: ${item.pullRequestCount}`;
    }

    return `Linked PR${item.pullRequestCount > 1 ? "s" : ""}: ${item.pullRequestCount}`;
  }

  if (item.commitCount > 0) {
    return `Commits: ${item.commitCount}`;
  }

  return "No commits or pull requests";
}

function TaskCardDevelopmentIndicator({ item }: { item: TimelineRowItem }) {
  const label = formatDevelopmentIndicatorLabel(item);

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

export function TimelineBoard({ timeline }: TimelineBoardProps) {
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
      return;
    }

    const isTaskVisible = visibleRows.some((row) =>
      row.items.some((item) => item.issueId === selectedTask.item.issueId),
    );

    if (!isTaskVisible) {
      setSelectedTask(null);
    }
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
          Selected range contains no working days.
        </div>
      ) : null}

      {timeline.columns.length > 0 && visibleRows.length === 0 ? (
        <div className="timeline-board__empty">
          {activePerson
            ? `No tasks related to ${activePerson} in the selected timeline range.`
            : "No tasks intersect the selected timeline range."}
        </div>
      ) : null}

      <div className="timeline-board__legend">
        {activePerson ? (
          <button
            className="legend-item legend-item--button legend-item--reset"
            onClick={() => setActivePerson(null)}
            type="button"
          >
            <span>Show all</span>
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
            <div className="timeline-grid__header-label">Epic / Work</div>

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
                      {row.items.length} tasks in lane
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
                          <TaskCardDevelopmentIndicator item={item} />
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
              <span className="eyebrow">Task details</span>
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
                  Open in Jira
                </a>
              ) : null}

              <button
                aria-label="Close task details"
                className="task-dialog__close"
                onClick={() => setSelectedTask(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>

              <p className="task-dialog__summary">{selectedTask.item.summary}</p>

              <div className="task-dialog__table-wrap">
                <table className="task-dialog__table">
                  <tbody>
                    <tr>
                      <th scope="row">Epic</th>
                      <td>
                        {selectedTask.epicKey} · {selectedTask.epicSummary}
                      </td>
                    </tr>

                    <tr>
                      <th scope="row">Assignee</th>
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
                      <th scope="row">Status</th>
                      <td>{selectedTask.item.statusLabel}</td>
                    </tr>

                    <tr>
                      <th scope="row">Created</th>
                      <td>{selectedTask.item.createdLabel ?? "Date not available"}</td>
                    </tr>

                    <tr>
                      <th scope="row">Started</th>
                      <td>{selectedTask.item.startLabel ?? "Start not observed"}</td>
                    </tr>

                    <tr>
                      <th scope="row">Due date</th>
                      <td>{selectedTask.item.dueLabel ?? "No due date"}</td>
                    </tr>

                    <tr>
                      <th scope="row">Estimate</th>
                      <td>{formatEstimateLabel(selectedTask.item)}</td>
                    </tr>

                    <tr>
                      <th scope="row">Finished</th>
                      <td>{selectedTask.item.resolvedLabel ?? "Not completed"}</td>
                    </tr>

                    <tr>
                      <th scope="row">Assignee history</th>
                      <td>
                        {selectedTask.item.assigneeHistory.length > 0
                          ? selectedTask.item.assigneeHistory.join(", ")
                          : "No assignees observed"}
                      </td>
                    </tr>

                    <tr>
                      <th scope="row">Author</th>
                      <td>{selectedTask.item.authorName ?? "Author not available"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {selectedTask.item.isMissingDueDate ? (
                <div className="task-dialog__field task-dialog__field--warning">
                  <span>Attention</span>
                  <strong>Task is in progress, but due date is missing.</strong>
                </div>
              ) : null}
        </div>,
        document.body,
          )
        : null}
    </div>
  );
}
