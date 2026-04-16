import { SyncStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/jira/client", () => ({
  resolveJiraRuntimeConfig: vi.fn(),
  searchJiraIssuesPage: vi.fn(),
}));

import { prisma } from "@/modules/db/prisma";
import {
  resolveJiraRuntimeConfig,
  searchJiraIssuesPage,
  type JiraRuntimeConfig,
} from "@/modules/jira/client";
import { runJiraSync, runJiraSyncChunk } from "@/modules/jira/persist";
import type { JiraIssue, JiraSearchResponse } from "@/modules/jira/types";
import { loadTimelineDashboard } from "@/modules/timeline/load-dashboard";

const runtime: JiraRuntimeConfig = {
  connectionName: "Smoke Jira",
  baseUrl: "https://smoke.example.atlassian.net",
  defaultJql: "project in (CORE, OPS) ORDER BY Rank ASC",
  timezone: "Europe/Moscow",
  authMode: "basic",
  apiVersion: "3",
  authHeader: "Basic smoke-token",
  storyPointFieldIds: [],
  developmentFieldIds: [],
};

function buildTaskIssue(params: {
  id: string;
  key: string;
  summary: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  epicId: string;
  epicKey: string;
  epicSummary: string;
  dueDate: string;
}) {
  return {
    id: params.id,
    key: params.key,
    fields: {
      summary: params.summary,
      project: {
        id: params.projectId,
        key: params.projectKey,
        name: params.projectName,
      },
      issuetype: {
        name: "Story",
      },
      status: {
        name: "In Progress",
        statusCategory: {
          key: "indeterminate",
          name: "In Progress",
        },
      },
      assignee: {
        accountId: `acc-${params.projectKey.toLowerCase()}`,
        displayName: `${params.projectKey} Owner`,
      },
      components: [
        {
          name: params.projectName,
        },
      ],
      duedate: params.dueDate,
      resolutiondate: null,
      creator: {
        displayName: "Smoke Creator",
      },
      reporter: {
        displayName: "Smoke Reporter",
      },
      created: "2026-04-14T08:00:00.000Z",
      updated: "2026-04-16T10:00:00.000Z",
      parent: {
        id: params.epicId,
        key: params.epicKey,
        fields: {
          summary: params.epicSummary,
        },
      },
    },
    changelog: {
      histories: [
        {
          id: `${params.key}:history:1`,
          created: "2026-04-14T09:00:00.000Z",
          items: [
            {
              field: "status",
              fromString: "To Do",
              toString: "In Progress",
            },
          ],
        },
      ],
    },
  } satisfies JiraIssue;
}

function buildSearchPage(params: {
  startAt: number;
  total: number;
  maxResults: number;
  issues: JiraIssue[];
}) {
  return {
    issues: params.issues,
    total: params.total,
    startAt: params.startAt,
    maxResults: params.maxResults,
    runtime,
  } satisfies JiraSearchResponse & { runtime: JiraRuntimeConfig };
}

function flattenIssueKeys(
  dashboard: Awaited<ReturnType<typeof loadTimelineDashboard>>,
) {
  return (
    dashboard.timeline?.rows
      .flatMap((row) => row.items.map((item) => item.issueKey))
      .sort() ?? []
  );
}

const mockedResolveJiraRuntimeConfig = vi.mocked(resolveJiraRuntimeConfig);
const mockedSearchJiraIssuesPage = vi.mocked(searchJiraIssuesPage);

describe("real smoke sync gate", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await prisma.jiraConnection.deleteMany();
    mockedResolveJiraRuntimeConfig.mockResolvedValue(runtime);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stages chunked sync pages, publishes final data, and scopes dashboard queries by project", async () => {
    const coreIssue = buildTaskIssue({
      id: "core-101",
      key: "CORE-101",
      summary: "Ship quality gates",
      projectId: "core-project",
      projectKey: "CORE",
      projectName: "Core Platform",
      epicId: "core-epic",
      epicKey: "CORE-100",
      epicSummary: "Core quality",
      dueDate: "2026-04-18",
    });
    const opsIssue = buildTaskIssue({
      id: "ops-101",
      key: "OPS-101",
      summary: "Verify publish gate",
      projectId: "ops-project",
      projectKey: "OPS",
      projectName: "Ops Platform",
      epicId: "ops-epic",
      epicKey: "OPS-100",
      epicSummary: "Ops quality",
      dueDate: "2026-04-21",
    });

    mockedSearchJiraIssuesPage.mockImplementation(async ({ startAt = 0 }) => {
      if (startAt === 0) {
        return buildSearchPage({
          startAt: 0,
          total: 2,
          maxResults: 1,
          issues: [coreIssue],
        });
      }

      if (startAt === 1) {
        return buildSearchPage({
          startAt: 1,
          total: 2,
          maxResults: 1,
          issues: [opsIssue],
        });
      }

      throw new Error(`Unexpected Jira page startAt=${startAt}.`);
    });

    const firstChunk = await runJiraSyncChunk({
      maxResults: 1,
    });

    expect(firstChunk.page.hasMore).toBe(true);
    expect(firstChunk.page.nextStartAt).toBe(1);
    expect(await prisma.stagedIssue.count()).toBe(1);
    expect(await prisma.issue.count()).toBe(0);
    expect(
      await prisma.syncRun.findUniqueOrThrow({
        where: {
          id: firstChunk.syncRunId,
        },
        select: {
          status: true,
          issuesFetched: true,
        },
      }),
    ).toEqual({
      status: SyncStatus.STARTED,
      issuesFetched: 1,
    });

    const secondChunk = await runJiraSyncChunk({
      syncRunId: firstChunk.syncRunId,
      startAt: firstChunk.page.nextStartAt ?? 0,
      maxResults: 1,
    });

    expect(secondChunk.page.hasMore).toBe(false);
    expect(await prisma.stagedIssue.count()).toBe(0);
    expect(
      await prisma.issue.count({
        where: {
          issueType: {
            not: "Epic",
          },
        },
      }),
    ).toBe(2);
    expect(
      await prisma.syncRun.findUniqueOrThrow({
        where: {
          id: firstChunk.syncRunId,
        },
        select: {
          status: true,
          issuesFetched: true,
        },
      }),
    ).toEqual({
      status: SyncStatus.SUCCEEDED,
      issuesFetched: 2,
    });

    const dashboard = await loadTimelineDashboard({
      from: "2026-04-14",
      to: "2026-04-22",
    });

    expect(dashboard.errorMessage).toBeNull();
    expect(dashboard.latestSync).toEqual({
      status: "SUCCEEDED",
      issuesFetched: 2,
      requestedJql: runtime.defaultJql,
    });
    expect(dashboard.projectFilter.options.map((option) => option.label)).toEqual([
      "CORE · Core Platform (Smoke Jira)",
      "OPS · Ops Platform (Smoke Jira)",
    ]);
    expect(flattenIssueKeys(dashboard)).toEqual(["CORE-101", "OPS-101"]);

    const connection = await prisma.jiraConnection.findUniqueOrThrow({
      where: {
        baseUrl: runtime.baseUrl,
      },
      select: {
        id: true,
      },
    });
    const coreProject = await prisma.jiraProject.findUniqueOrThrow({
      where: {
        jiraConnectionId_key: {
          jiraConnectionId: connection.id,
          key: "CORE",
        },
      },
      select: {
        id: true,
      },
    });
    const scopedDashboard = await loadTimelineDashboard({
      project: coreProject.id,
      from: "2026-04-14",
      to: "2026-04-22",
    });

    expect(scopedDashboard.projectFilter.selectedProjectId).toBe(coreProject.id);
    expect(flattenIssueKeys(scopedDashboard)).toEqual(["CORE-101"]);
  });

  it("marks a failed sync run as failed and keeps staged data out of the published dashboard", async () => {
    const coreIssue = buildTaskIssue({
      id: "core-101",
      key: "CORE-101",
      summary: "Ship quality gates",
      projectId: "core-project",
      projectKey: "CORE",
      projectName: "Core Platform",
      epicId: "core-epic",
      epicKey: "CORE-100",
      epicSummary: "Core quality",
      dueDate: "2026-04-18",
    });

    mockedSearchJiraIssuesPage.mockImplementation(async ({ startAt = 0 }) => {
      if (startAt === 0) {
        return buildSearchPage({
          startAt: 0,
          total: 2,
          maxResults: 1,
          issues: [coreIssue],
        });
      }

      throw new Error("Simulated Jira page failure.");
    });

    await expect(
      runJiraSync({
        maxResults: 1,
      }),
    ).rejects.toThrow("Simulated Jira page failure.");

    expect(await prisma.issue.count()).toBe(0);
    expect(await prisma.jiraProject.count()).toBe(0);
    expect(await prisma.stagedJiraProject.count()).toBe(0);
    expect(await prisma.stagedEpic.count()).toBe(0);
    expect(await prisma.stagedIssue.count()).toBe(0);

    const failedSyncRun = await prisma.syncRun.findFirstOrThrow({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        status: true,
        errorMessage: true,
      },
    });

    expect(failedSyncRun.status).toBe(SyncStatus.FAILED);
    expect(failedSyncRun.errorMessage).toContain("Simulated Jira page failure.");

    const dashboard = await loadTimelineDashboard({
      from: "2026-04-14",
      to: "2026-04-22",
    });

    expect(dashboard.timeline).toBeNull();
    expect(dashboard.latestSync).toBeNull();
    expect(dashboard.hasAnyIssues).toBe(false);
  });
});
