import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/jira/persist", () => ({
  runJiraSync: vi.fn().mockResolvedValue({ ok: true }),
  runJiraSyncChunk: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/modules/jira/abort", () => ({
  JIRA_SYNC_ABORT_MESSAGE: "Sync aborted.",
  combineSignals: (signal: AbortSignal) => signal,
  isAbortError: () => false,
}));

import { POST } from "./route";
import { SYNC_ACTION_HEADER, SYNC_ACTION_VALUE } from "@/modules/auth/sync-action";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3001/api/jira/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SYNC_ACTION_HEADER]: SYNC_ACTION_VALUE,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/jira/sync — request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing Content-Type with 415", async () => {
    const request = new Request("http://localhost:3001/api/jira/sync", {
      method: "POST",
      headers: {
        [SYNC_ACTION_HEADER]: SYNC_ACTION_VALUE,
      },
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(415);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.message).toContain("Content-Type");
  });

  it("rejects missing X-Anathema-Action header with 403", async () => {
    const request = new Request("http://localhost:3001/api/jira/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.message).toContain("X-Anathema-Action");
  });

  it("rejects invalid JSON body with 400", async () => {
    const request = new Request("http://localhost:3001/api/jira/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SYNC_ACTION_HEADER]: SYNC_ACTION_VALUE,
      },
      body: "{invalid",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.message).toContain("valid JSON");
  });

  it("accepts a well-formed request", async () => {
    const request = makeRequest({ chunked: true, startAt: 0 });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("rejects chunk continuation without syncRunId with 400", async () => {
    const request = makeRequest({ chunked: true, startAt: 100 });
    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.message).toContain("syncRunId");
  });
});
