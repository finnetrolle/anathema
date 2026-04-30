import { runJiraSync, runJiraSyncChunk } from "@/modules/jira/persist";
import {
  JIRA_SYNC_ABORT_MESSAGE,
  combineSignals,
  isAbortError,
} from "@/modules/jira/abort";
import {
  SYNC_ACTION_HEADER,
  SYNC_ACTION_VALUE,
} from "@/modules/auth/sync-action";

const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

const APP_BASE_URL = process.env.APP_BASE_URL ?? "";

type SyncRequestBody = {
  jql?: string;
  chunked?: boolean;
  syncRunId?: string;
  startAt?: number;
};

function reject(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return reject(415, "Content-Type must be application/json.");
  }

  const actionHeader = request.headers.get(SYNC_ACTION_HEADER.toLowerCase());
  if (actionHeader !== SYNC_ACTION_VALUE) {
    return reject(403, "Missing or invalid X-Anathema-Action header.");
  }

  if (APP_BASE_URL) {
    const origin = request.headers.get("origin");
    if (origin && origin !== APP_BASE_URL) {
      return reject(403, "Cross-origin requests are not allowed.");
    }
  }

  let body: SyncRequestBody;
  try {
    body = (await request.json()) as SyncRequestBody;
  } catch {
    return reject(400, "Request body must be valid JSON.");
  }

  const signal = combineSignals(request.signal, SYNC_TIMEOUT_MS);

  try {
    const requestedJql = body.jql?.trim() || undefined;
    const startAt =
      typeof body.startAt === "number" && Number.isFinite(body.startAt)
        ? Math.max(0, Math.trunc(body.startAt))
        : 0;
    const isChunkRequest = body.chunked || body.syncRunId || startAt > 0;

    if (startAt > 0 && !body.syncRunId) {
      return reject(400, "Chunk continuation requires syncRunId.");
    }

    const summary = isChunkRequest
      ? await runJiraSyncChunk({
          jql: requestedJql,
          syncRunId: body.syncRunId,
          startAt,
          maxResults: 25,
          signal,
        })
      : await runJiraSync({
          jql: requestedJql,
          maxResults: 25,
          signal,
        });

    return Response.json(summary);
  } catch (error) {
    const isCancelled = isAbortError(error);
    const message = isCancelled
      ? JIRA_SYNC_ABORT_MESSAGE
      : error instanceof Error
        ? error.message
        : "Unknown Jira sync error.";

    return Response.json(
      { ok: false, message },
      { status: isCancelled ? 499 : 500 },
    );
  }
}
