import { runJiraSync, runJiraSyncChunk } from "@/modules/jira/persist";
import {
  JIRA_SYNC_ABORT_MESSAGE,
  isAbortError,
} from "@/modules/jira/abort";

type SyncRequestBody = {
  jql?: string;
  chunked?: boolean;
  syncRunId?: string;
  startAt?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const requestedJql = body.jql?.trim() || undefined;
    const startAt =
      typeof body.startAt === "number" && Number.isFinite(body.startAt)
        ? Math.max(0, Math.trunc(body.startAt))
        : 0;
    const summary =
      body.chunked || body.syncRunId || startAt > 0
        ? await runJiraSyncChunk({
            jql: requestedJql,
            syncRunId: body.syncRunId,
            startAt,
            maxResults: 25,
            signal: request.signal,
          })
        : await runJiraSync({
            jql: requestedJql,
            maxResults: 25,
            signal: request.signal,
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
