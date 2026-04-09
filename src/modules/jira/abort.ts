export const JIRA_SYNC_ABORT_MESSAGE = "Sync cancelled by user.";

function createAbortError(message = JIRA_SYNC_ABORT_MESSAGE) {
  const error = new Error(message);
  error.name = "AbortError";

  return error;
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
