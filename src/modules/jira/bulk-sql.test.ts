import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/db/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/modules/jira/abort", () => ({
  throwIfAborted: vi.fn(),
}));

import { prisma } from "@/modules/db/prisma";
import { bulkUpsertReturning, rawSqlCreateReturning } from "./bulk-sql";

const mockQueryRawUnsafe = vi.mocked(prisma.$queryRawUnsafe);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bulkUpsertReturning", () => {
  it("returns empty array for empty rows", async () => {
    const result = await bulkUpsertReturning({
      table: "TestTable",
      columns: ["id", "name"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows: [],
    });
    expect(result).toEqual([]);
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("generates correct INSERT ... ON CONFLICT ... DO UPDATE SET ... RETURNING SQL", async () => {
    mockQueryRawUnsafe.mockResolvedValue([{ id: "1" }]);

    await bulkUpsertReturning({
      table: "JiraProject",
      columns: ["id", "key", "name"],
      conflictColumns: ["id"],
      returningColumns: ["id", "key"],
      rows: [{ id: "p1", key: "PROJ", name: "Project 1" }],
    });

    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = mockQueryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];

    expect(sql).toContain('INSERT INTO "JiraProject"');
    expect(sql).toContain('"id", "key", "name"');
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain('"id"');
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain('"key" = EXCLUDED."key"');
    expect(sql).toContain('"name" = EXCLUDED."name"');
    expect(sql).toContain("RETURNING");
    expect(sql).toContain('"id", "key"');

    expect(params).toEqual(["p1", "PROJ", "Project 1"]);
  });

  it("uses updateOverrides for custom SET expressions", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await bulkUpsertReturning({
      table: "Issue",
      columns: ["id", "key", "summary"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows: [{ id: "1", key: "K", summary: "S" }],
      updateOverrides: {
        summary: "EXCLUDED.summary || ' (updated)'",
      },
    });

    const [sql] = mockQueryRawUnsafe.mock.calls[0] as [string];
    expect(sql).toContain(
      '"summary" = EXCLUDED.summary || \' (updated)\'',
    );
    expect(sql).not.toContain('"summary" = EXCLUDED."summary"');
  });

  it("applies typeCasts for specified columns", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await bulkUpsertReturning({
      table: "Issue",
      columns: ["id", "rawPayload"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows: [{ id: "1", rawPayload: { foo: "bar" } }],
      typeCasts: { rawPayload: "jsonb" },
    });

    const [sql] = mockQueryRawUnsafe.mock.calls[0] as [string];
    expect(sql).toMatch(/\$2::jsonb/);
    expect(sql).not.toMatch(/\$1::/);
  });

  it("chunks rows exceeding chunkSize", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      name: `name-${i}`,
    }));

    await bulkUpsertReturning({
      table: "T",
      columns: ["id", "name"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows,
      chunkSize: 2,
    });

    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("collects results from all chunks", async () => {
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([{ id: "c" }]);

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      name: `n${i}`,
    }));

    const result = await bulkUpsertReturning({
      table: "T",
      columns: ["id", "name"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows,
      chunkSize: 2,
    });

    expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("substitutes null for missing row values", async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await bulkUpsertReturning({
      table: "T",
      columns: ["id", "optional"],
      conflictColumns: ["id"],
      returningColumns: ["id"],
      rows: [{ id: "1" }],
    });

    const [, ...params] = mockQueryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(params).toEqual(["1", null]);
  });
});

describe("rawSqlCreateReturning", () => {
  it("returns empty array for empty rows", async () => {
    const mockTx = { $queryRawUnsafe: vi.fn() };
    const result = await rawSqlCreateReturning({
      table: "T",
      columns: ["id"],
      rows: [],
      returningColumns: ["id"],
      tx: mockTx as unknown as import("@prisma/client").Prisma.TransactionClient,
    });
    expect(result).toEqual([]);
    expect(mockTx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("generates INSERT ... RETURNING without ON CONFLICT", async () => {
    const mockTx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "x" }]),
    };

    await rawSqlCreateReturning({
      table: "JiraProject",
      columns: ["id", "name"],
      rows: [{ id: "p1", name: "Proj" }],
      returningColumns: ["id"],
      tx: mockTx as unknown as import("@prisma/client").Prisma.TransactionClient,
    });

    expect(mockTx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = mockTx.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];

    expect(sql).toContain('INSERT INTO "JiraProject"');
    expect(sql).toContain("RETURNING");
    expect(sql).not.toContain("ON CONFLICT");
    expect(params).toEqual(["p1", "Proj"]);
  });

  it("uses tx.$queryRawUnsafe instead of prisma global", async () => {
    const mockTx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "1" }]),
    };

    await rawSqlCreateReturning({
      table: "T",
      columns: ["id"],
      rows: [{ id: "1" }],
      returningColumns: ["id"],
      tx: mockTx as unknown as import("@prisma/client").Prisma.TransactionClient,
    });

    expect(mockTx.$queryRawUnsafe).toHaveBeenCalled();
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("applies typeCasts", async () => {
    const mockTx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };

    await rawSqlCreateReturning({
      table: "T",
      columns: ["id", "data"],
      rows: [{ id: "1", data: {} }],
      returningColumns: ["id"],
      tx: mockTx as unknown as import("@prisma/client").Prisma.TransactionClient,
      typeCasts: { data: "jsonb" },
    });

    const [sql] = mockTx.$queryRawUnsafe.mock.calls[0] as [string];
    expect(sql).toMatch(/\$2::jsonb/);
  });

  it("chunks large batches", async () => {
    const mockTx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };

    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(i),
      val: i,
    }));

    await rawSqlCreateReturning({
      table: "T",
      columns: ["id", "val"],
      rows,
      returningColumns: ["id"],
      tx: mockTx as unknown as import("@prisma/client").Prisma.TransactionClient,
      chunkSize: 2,
    });

    expect(mockTx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
});
