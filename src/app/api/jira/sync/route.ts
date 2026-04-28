import { runJiraSync, runJiraSyncChunk } from "@/modules/jira/persist";
import {
  JIRA_SYNC_ABORT_MESSAGE,
  combineSignals,
  isAbortError,
} from "@/modules/jira/abort";

const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

type SyncRequestBody = {
  jql?: string;
  chunked?: boolean;
  syncRunId?: string;
  startAt?: number;
};

export async function POST(request: Request) {
  const signal = combineSignals(request.signal, SYNC_TIMEOUT_MS);

  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const requestedJql = body.jql?.trim() || undefined;
    const startAt =
      typeof body.startAt === "number" && Number.isFinite(body.startAt)
        ? Math.max(0, Math.trunc(body.startAt))
        : 0;
    const isChunkRequest = body.chunked || body.syncRunId || startAt > 0;

    if (startAt > 0 && !body.syncRunId) {
      return Response.json(
        {
          ok: false,
          message: "Chunk continuation requires syncRunId.",
        },
        {
          status: 400,
        },
      );
    }

    const summary =
      isChunkRequest
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
      {
        ok: false,
        message,
      },
      {
        status: isCancelled ? 499 : 500,
      },
    );
  }
}
