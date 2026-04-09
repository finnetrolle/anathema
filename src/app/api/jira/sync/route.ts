import { runJiraSync } from "@/modules/jira/persist";
import {
  JIRA_SYNC_ABORT_MESSAGE,
  isAbortError,
} from "@/modules/jira/abort";

type SyncRequestBody = {
  jql?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;
    const requestedJql = body.jql?.trim() || undefined;
    const summary = await runJiraSync({
      jql: requestedJql,
      maxResults: 100,
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
