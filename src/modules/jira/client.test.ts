import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveJiraRuntimeConfig,
  searchJiraIssuesPage,
  type JiraRuntimeConfig,
} from "@/modules/jira/client";

describe("jira client response parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("raises a helpful error when Jira serverInfo returns HTML", async () => {
    vi.stubEnv("JIRA_BASE_URL", "https://jira.example.com/jira");
    vi.stubEnv("JIRA_API_TOKEN", "secret-token");
    vi.stubEnv("JIRA_DEFAULT_JQL", "project = CORE ORDER BY Rank ASC");
    vi.stubEnv("JIRA_AUTH_MODE", "bearer");
    vi.stubEnv("JIRA_API_VERSION", "2");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><head><title>Login</title></head><body></body></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      ),
    );

    let message = "";

    try {
      await resolveJiraRuntimeConfig();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/Jira server info endpoint returned HTML instead of JSON/i);
    expect(message).toMatch(/login/i);
  });

  it("raises a helpful error when Jira search returns HTML", async () => {
    const runtime: JiraRuntimeConfig = {
      connectionName: "Primary Jira",
      baseUrl: "https://jira.example.com/jira",
      defaultJql: "project = CORE ORDER BY Rank ASC",
      timezone: "Europe/Moscow",
      authMode: "bearer",
      apiVersion: "2",
      authHeader: "Bearer secret-token",
      storyPointFieldIds: [],
      developmentFieldIds: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><head><title>SSO Redirect</title></head><body></body></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        }),
      ),
    );

    let message = "";

    try {
      await searchJiraIssuesPage({ runtime });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/Jira search endpoint returned HTML instead of JSON/i);
    expect(message).toMatch(/redirect/i);
  });

  it("falls back to the next auth mode when auto-detect gets HTML from serverInfo", async () => {
    vi.stubEnv("JIRA_BASE_URL", "https://jira.example.com/jira");
    vi.stubEnv("JIRA_EMAIL", "jira-bot@example.com");
    vi.stubEnv("JIRA_API_TOKEN", "secret-token");
    vi.stubEnv("JIRA_DEFAULT_JQL", "project = CORE ORDER BY Rank ASC");
    vi.stubEnv("JIRA_AUTH_MODE", "auto");
    vi.stubEnv("JIRA_API_VERSION", "2");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html><head><title>Login</title></head><body></body></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version: "9.0.0" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const runtime = await resolveJiraRuntimeConfig();

    expect(runtime.authMode).toBe("basic");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://jira.example.com/jira/rest/api/2/serverInfo?os_authType=basic",
    );
  });

  it("adds os_authType=basic for self-hosted Jira search requests", async () => {
    const runtime: JiraRuntimeConfig = {
      connectionName: "Primary Jira",
      baseUrl: "https://jira.example.com/jira",
      defaultJql: "project = CORE ORDER BY Rank ASC",
      timezone: "Europe/Moscow",
      authMode: "basic",
      apiVersion: "2",
      authHeader: "Basic secret-token",
      storyPointFieldIds: [],
      developmentFieldIds: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          issues: [],
          total: 0,
          startAt: 0,
          maxResults: 100,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await searchJiraIssuesPage({ runtime });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://jira.example.com/jira/rest/api/2/search?os_authType=basic",
    );
  });
});
