import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

import type { AppLocale } from "@/modules/i18n/config";
import { getRiskLevelLabel } from "@/modules/timeline/risk-helpers";
import type { TimelineRowItem } from "@/modules/timeline/types";
import {
  COPY,
  buildRiskLevelClass,
  formatEstimateLabel,
} from "@/components/timeline/timeline-copy";
import type { SelectedTask } from "@/components/timeline/use-task-selection";

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

export function TaskDetailDialog({
  selectedTask,
  popoverRef,
  popoverStyle,
  locale,
  onClose,
}: {
  selectedTask: SelectedTask;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  popoverStyle: CSSProperties;
  locale: AppLocale;
  onClose: () => void;
}) {
  const copy = COPY[locale];

  return createPortal(
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
            onClick={onClose}
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
  );
}
