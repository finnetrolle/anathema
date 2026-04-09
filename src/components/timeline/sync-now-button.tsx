"use client";

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

type SyncResponse = {
  ok?: boolean;
  message?: string;
  requestedJql?: string;
  issuesFetched?: number;
  projectsSynced?: number;
  epicsSynced?: number;
  assigneesSynced?: number;
  issuesSynced?: number;
  statusTransitionsSynced?: number;
};

type SyncSummary = {
  requestedJql: string;
  issuesFetched: number;
  projectsSynced: number;
  epicsSynced: number;
  assigneesSynced: number;
  issuesSynced: number;
  statusTransitionsSynced: number;
};

type SyncNowButtonProps = {
  initialJql?: string;
};

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function SyncNowButton({
  initialJql = "",
}: SyncNowButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [jql, setJql] = useState(initialJql);
  const [status, setStatus] = useState<"idle" | "syncing" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestCounterRef = useRef(0);
  const activeRequestIdRef = useRef<number | null>(null);
  const titleId = useId();
  const isSyncing = status === "syncing";

  const handleClose = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeRequestIdRef.current = null;
    setIsOpen(false);
    setStatus("idle");
    setMessage(null);
    setSummary(null);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      handleClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setStatus("idle");
    setMessage(null);
    setSummary(null);
  };

  const handleSync = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const requestId = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;
    activeRequestIdRef.current = requestId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("syncing");
    setMessage(null);
    setSummary(null);

    try {
      const normalizedJql = jql.trim();
      const response = await fetch("/api/jira/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedJql ? { jql: normalizedJql } : {}),
        signal: controller.signal,
      });
      const payload = (await response.json()) as SyncResponse;

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      if (!response.ok || !payload.ok) {
        setStatus("error");
        setMessage(payload.message ?? "Не удалось выполнить синхронизацию.");
        return;
      }

      setSummary({
        requestedJql: payload.requestedJql ?? normalizedJql,
        issuesFetched: payload.issuesFetched ?? 0,
        projectsSynced: payload.projectsSynced ?? 0,
        epicsSynced: payload.epicsSynced ?? 0,
        assigneesSynced: payload.assigneesSynced ?? 0,
        issuesSynced: payload.issuesSynced ?? 0,
        statusTransitionsSynced: payload.statusTransitionsSynced ?? 0,
      });
      setStatus("success");

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }

      if (activeRequestIdRef.current !== requestId) {
        return;
      }

      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить синхронизацию.",
      );
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <>
      <button
        className="timeline-button timeline-button--ghost"
        onClick={handleOpen}
        type="button"
      >
        Синхронизация
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="sync-modal-backdrop">
              <div
                aria-busy={isSyncing}
                aria-labelledby={titleId}
                aria-modal="true"
                className="sync-modal"
                role="dialog"
              >
                <div className="sync-modal__header">
                  <div>
                    <span className="eyebrow">Jira Sync</span>
                    <h3 id={titleId}>Синхронизация данных</h3>
                  </div>

                  <button
                    className="timeline-button timeline-button--ghost"
                    onClick={handleClose}
                    type="button"
                  >
                    Закрыть
                  </button>
                </div>

                <form className="sync-modal__form" onSubmit={handleSync}>
                  <label className="timeline-field sync-modal__field">
                    <span>JQL</span>
                    <textarea
                      autoFocus
                      className="sync-modal__textarea"
                      disabled={isSyncing}
                      onChange={(event) => setJql(event.target.value)}
                      placeholder="project = CORE ORDER BY Rank ASC"
                      rows={4}
                      value={jql}
                    />
                  </label>

                  <p className="sync-modal__hint">
                    Оставьте поле пустым, чтобы использовать JQL по умолчанию.
                  </p>

                  <div className="sync-modal__actions">
                    <button
                      className="timeline-button"
                      disabled={isSyncing}
                      type="submit"
                    >
                      {isSyncing ? "Синхронизация..." : "Синхронизировать"}
                    </button>
                  </div>
                </form>

                {isSyncing ? (
                  <div
                    aria-live="polite"
                    className="sync-modal__status-card"
                    role="status"
                  >
                    <div className="sync-modal__loader">
                      <span aria-hidden="true" className="sync-modal__spinner" />
                      <div>
                        <strong>Синхронизация выполняется</strong>
                        <p>Загружаем задачи из Jira и обновляем локальные данные.</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {status === "success" && summary ? (
                  <div
                    aria-live="polite"
                    className="sync-modal__status-card"
                  >
                    <span className="eyebrow">Готово</span>
                    <h4>Данные успешно обновлены</h4>

                    <dl className="sync-modal__summary-list">
                      <div>
                        <dt>JQL</dt>
                        <dd>
                          <code>{summary.requestedJql || "JQL по умолчанию"}</code>
                        </dd>
                      </div>

                      <div>
                        <dt>Задач из Jira</dt>
                        <dd>{summary.issuesFetched}</dd>
                      </div>

                      <div>
                        <dt>Проектов</dt>
                        <dd>{summary.projectsSynced}</dd>
                      </div>

                      <div>
                        <dt>Эпиков</dt>
                        <dd>{summary.epicsSynced}</dd>
                      </div>

                      <div>
                        <dt>Исполнителей</dt>
                        <dd>{summary.assigneesSynced}</dd>
                      </div>

                      <div>
                        <dt>Задач сохранено</dt>
                        <dd>{summary.issuesSynced}</dd>
                      </div>

                      <div>
                        <dt>Переходов статусов</dt>
                        <dd>{summary.statusTransitionsSynced}</dd>
                      </div>
                    </dl>
                  </div>
                ) : null}

                {status === "error" && message ? (
                  <div
                    aria-live="assertive"
                    className="sync-modal__status-card sync-modal__status-card--error"
                    role="alert"
                  >
                    <strong>Синхронизация завершилась с ошибкой</strong>
                    <p>{message}</p>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
