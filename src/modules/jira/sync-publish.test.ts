import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/db/prisma", () => ({
  prisma: {
    jiraConnection: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn(mockTx)),
  },
}));

vi.mock("@/modules/jira/abort", () => ({
  throwIfAborted: vi.fn(),
  isAbortError: vi.fn((e: unknown) => e instanceof DOMException && e.name === "AbortError"),
}));

vi.mock("@/modules/jira/bulk-sql", () => ({
  rawSqlCreateReturning: vi.fn().mockResolvedValue([{ id: "pub-1" }]),
}));

import { prisma } from "@/modules/db/prisma";
import { throwIfAborted, isAbortError } from "@/modules/jira/abort";
import { rawSqlCreateReturning } from "@/modules/jira/bulk-sql";
import {
  acquireJiraConnectionLock,
  cleanupStagedSyncRun,
  upsertJiraConnection,
  publishSyncRun,
  failSyncRun,
} from "./sync-publish";

const mockPrisma = vi.mocked(prisma);
const mockThrowIfAborted = vi.mocked(throwIfAborted);
const mockIsAbortError = vi.mocked(isAbortError);
const mockRawSqlCreateReturning = vi.mocked(rawSqlCreateReturning);

// Shared mock transaction client
function createMockTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ advisoryLock: "t" }]),
    stagedJiraProject: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    stagedAssignee: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    stagedEpic: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    stagedIssue: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    stagedIssueStatusHistory: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    jiraProject: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    assignee: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    syncRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "sr-1" }),
    },
    issueStatusHistory: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

let mockTx: ReturnType<typeof createMockTx>;

beforeEach(() => {
  vi.clearAllMocks();
  mockTx = createMockTx();
  // Default: $transaction passes the callback a mock tx
  vi.mocked(mockPrisma.$transaction).mockImplementation(
    (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  );
});

// ── acquireJiraConnectionLock ──

describe("acquireJiraConnectionLock", () => {
  it("calls pg_advisory_xact_lock with connection id", async () => {
    await acquireJiraConnectionLock(mockTx as unknown as Parameters<typeof acquireJiraConnectionLock>[0], "conn-1");
    expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

// ── cleanupStagedSyncRun ──

describe("cleanupStagedSyncRun", () => {
  it("deletes staged projects and assignees for the sync run", async () => {
    await cleanupStagedSyncRun(mockTx as any, "sr-1");
    expect(mockTx.stagedJiraProject.deleteMany).toHaveBeenCalledWith({
      where: { syncRunId: "sr-1" },
    });
    expect(mockTx.stagedAssignee.deleteMany).toHaveBeenCalledWith({
      where: { syncRunId: "sr-1" },
    });
  });
});

// ── upsertJiraConnection ──

describe("upsertJiraConnection", () => {
  const runtime = {
    baseUrl: "https://jira.example.com",
    connectionName: "My Jira",
    defaultJql: "project = PROJ",
    timezone: "UTC",
  } as any;

  it("calls prisma.jiraConnection.upsert with correct params", async () => {
    vi.mocked(mockPrisma.jiraConnection.upsert).mockResolvedValue({ id: "conn-1" } as any);

    const result = await upsertJiraConnection({ runtime, signal: undefined });

    expect(mockPrisma.jiraConnection.upsert).toHaveBeenCalledWith({
      where: { baseUrl: "https://jira.example.com" },
      update: {
        name: "My Jira",
        defaultJql: "project = PROJ",
        timezone: "UTC",
      },
      create: {
        name: "My Jira",
        baseUrl: "https://jira.example.com",
        defaultJql: "project = PROJ",
        timezone: "UTC",
      },
    });
    expect(result).toEqual({ id: "conn-1" });
  });

  it("calls throwIfAborted with the signal", async () => {
    const signal = new AbortController().signal;
    await upsertJiraConnection({ runtime, signal });
    expect(mockThrowIfAborted).toHaveBeenCalledWith(signal);
  });
});

// ── failSyncRun ──

describe("failSyncRun", () => {
  it("sets sync run status to FAILED with error message", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue({
      id: "sr-1",
      status: "STARTED",
    });

    await failSyncRun("sr-1", new Error("Something broke"));

    expect(mockTx.syncRun.update).toHaveBeenCalledWith({
      where: { id: "sr-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "Something broke",
      }),
    });
    // cleanup should have been called
    expect(mockTx.stagedJiraProject.deleteMany).toHaveBeenCalled();
    expect(mockTx.stagedAssignee.deleteMany).toHaveBeenCalled();
  });

  it("uses cancellation message for abort errors", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue({
      id: "sr-1",
      status: "STARTED",
    });
    mockIsAbortError.mockReturnValue(true);

    const abortError = new DOMException("Aborted", "AbortError");
    await failSyncRun("sr-1", abortError);

    expect(mockTx.syncRun.update).toHaveBeenCalledWith({
      where: { id: "sr-1" },
      data: expect.objectContaining({
        errorMessage: "Sync was cancelled.",
      }),
    });
  });

  it("does nothing if sync run is not found or not STARTED", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(null);

    await failSyncRun("sr-1", new Error("err"));

    expect(mockTx.syncRun.update).not.toHaveBeenCalled();
  });
});

// ── publishSyncRun ──

describe("publishSyncRun", () => {
  const happySyncRun = {
    id: "sr-1",
    jiraConnectionId: "conn-1",
    startedAt: new Date("2026-01-01"),
    status: "STARTED",
  };

  it("throws if sync run not found", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(null);

    await expect(
      publishSyncRun({ syncRunId: "sr-1", jiraConnectionId: "conn-1" }),
    ).rejects.toThrow("Sync run not found");
  });

  it("throws if sync run is no longer active", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue({
      ...happySyncRun,
      status: "SUCCEEDED",
    });

    await expect(
      publishSyncRun({ syncRunId: "sr-1", jiraConnectionId: "conn-1" }),
    ).rejects.toThrow("no longer active");
  });

  it("throws if sync run belongs to different connection", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue({
      ...happySyncRun,
      jiraConnectionId: "conn-other",
    });

    await expect(
      publishSyncRun({ syncRunId: "sr-1", jiraConnectionId: "conn-1" }),
    ).rejects.toThrow("different Jira connection");
  });

  it("throws if a newer sync run exists", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(happySyncRun);
    mockTx.syncRun.findFirst.mockResolvedValue({ id: "sr-2" });

    await expect(
      publishSyncRun({ syncRunId: "sr-1", jiraConnectionId: "conn-1" }),
    ).rejects.toThrow("newer sync run");
  });

  it("publishes staged data to live tables and sets SUCCEEDED", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(happySyncRun);

    const stagedProjects = [
      { id: "sp-1", jiraProjectId: "proj1", key: "PROJ", name: "Project" },
    ];
    const stagedAssignees = [
      {
        id: "sa-1",
        jiraAccountId: "account1",
        displayName: "Alice",
        email: "a@t.com",
        color: "#fff",
      },
    ];
    const stagedEpics = [
      {
        id: "se-1",
        stagedProjectId: "sp-1",
        jiraEpicId: "epic1",
        key: "PROJ-1",
        summary: "Epic",
        status: "In Progress",
        rank: 0,
        jiraUpdatedAt: new Date("2026-01-01"),
      },
    ];
    const stagedIssues = [
      {
        id: "si-1",
        stagedProjectId: "sp-1",
        stagedEpicId: "se-1",
        stagedAssigneeId: "sa-1",
        jiraIssueId: "issue1",
        key: "PROJ-2",
        summary: "Task",
        status: "To Do",
        issueType: "Task",
        priority: "Medium",
        dueAt: null,
        resolvedAt: null,
        startedAt: null,
        markerAt: null,
        markerKind: "NONE",
        jiraCreatedAt: new Date("2026-01-01"),
        jiraUpdatedAt: new Date("2026-01-02"),
        rawPayload: {},
      },
    ];
    const stagedHistory = [
      {
        id: "sh-1",
        stagedIssueId: "si-1",
        fromStatus: "To Do",
        toStatus: "In Progress",
        changedAt: new Date("2026-01-03"),
      },
    ];

    mockTx.stagedJiraProject.findMany.mockResolvedValue(stagedProjects as any);
    mockTx.stagedAssignee.findMany.mockResolvedValue(stagedAssignees as any);
    mockTx.stagedEpic.findMany.mockResolvedValue(stagedEpics as any);
    mockTx.stagedIssue.findMany.mockResolvedValue(stagedIssues as any);
    mockTx.stagedIssueStatusHistory.findMany.mockResolvedValue(
      stagedHistory as any,
    );

    // rawSqlCreateReturning returns published IDs
    mockRawSqlCreateReturning.mockImplementation((() =>
      Promise.resolve([{ id: "pub-1" }])) as any);

    await publishSyncRun({
      syncRunId: "sr-1",
      jiraConnectionId: "conn-1",
    });

    // Should clean up staged data
    expect(mockTx.stagedJiraProject.deleteMany).toHaveBeenCalledWith({
      where: { syncRunId: "sr-1" },
    });
    expect(mockTx.stagedAssignee.deleteMany).toHaveBeenCalledWith({
      where: { syncRunId: "sr-1" },
    });

    // Should set status to SUCCEEDED
    expect(mockTx.syncRun.update).toHaveBeenCalledWith({
      where: { id: "sr-1" },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        errorMessage: null,
      }),
    });

    // Should create live data via rawSqlCreateReturning
    expect(mockRawSqlCreateReturning).toHaveBeenCalled();

    // Should create issue history
    expect(mockTx.issueStatusHistory.createMany).toHaveBeenCalled();
  });

  it("throws on FK integrity violation: staged epic references missing project", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(happySyncRun);

    const stagedEpics = [
      {
        id: "se-1",
        stagedProjectId: "sp-missing",
        jiraEpicId: "epic1",
        key: "PROJ-1",
        summary: "Epic",
        status: "In Progress",
      },
    ];

    mockTx.stagedJiraProject.findMany.mockResolvedValue([
      { id: "sp-1", jiraProjectId: "proj1", key: "PROJ", name: "Project" },
    ] as any);
    mockTx.stagedEpic.findMany.mockResolvedValue(stagedEpics as any);
    mockTx.stagedAssignee.findMany.mockResolvedValue([]);
    mockTx.stagedIssue.findMany.mockResolvedValue([]);
    mockTx.stagedIssueStatusHistory.findMany.mockResolvedValue([]);

    await expect(
      publishSyncRun({ syncRunId: "sr-1", jiraConnectionId: "conn-1" }),
    ).rejects.toThrow("missing staged project");
  });

  it("publishes with empty staged data (no issues, no epics)", async () => {
    mockTx.syncRun.findUnique.mockResolvedValue(happySyncRun);

    // All staged tables empty (default mock returns [])
    await publishSyncRun({
      syncRunId: "sr-1",
      jiraConnectionId: "conn-1",
    });

    expect(mockTx.syncRun.update).toHaveBeenCalledWith({
      where: { id: "sr-1" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    // rawSqlCreateReturning should not have been called for empty data
    expect(mockRawSqlCreateReturning).not.toHaveBeenCalled();
  });
});
