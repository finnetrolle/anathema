import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/modules/db/prisma";
import { throwIfAborted } from "@/modules/jira/abort";

const BULK_CHUNK_SIZE = 500;

/**
 * Prisma @default(cuid()) and @updatedAt are client-side only.
 * Raw SQL bypasses Prisma, so we must inject these values ourselves.
 */
function injectMissingDefaults(
  columns: string[],
  rows: Record<string, unknown>[],
  options?: { injectUpdatedAt?: boolean },
): { columns: string[]; rows: Record<string, unknown>[] } {
  const needsId = !columns.includes("id");
  const needsUpdatedAt = options?.injectUpdatedAt !== false && !columns.includes("updatedAt");

  if (!needsId && !needsUpdatedAt) return { columns, rows };

  const now = new Date();
  const enrichedColumns = [...columns];

  if (needsId) enrichedColumns.push("id");
  if (needsUpdatedAt) enrichedColumns.push("updatedAt");

  const enrichedRows = rows.map((row) => ({
    ...row,
    ...(needsId ? { id: randomUUID() } : {}),
    ...(needsUpdatedAt ? { updatedAt: now } : {}),
  }));

  return { columns: enrichedColumns, rows: enrichedRows };
}

/**
 * Bulk upsert via raw SQL with RETURNING.
 * Chunks rows to stay under PostgreSQL's parameter limit (~65535).
 */
export async function bulkUpsertReturning(params: {
  table: string;
  columns: string[];
  conflictColumns: string[];
  returningColumns: string[];
  rows: Record<string, unknown>[];
  signal?: AbortSignal;
  updateOverrides?: Record<string, string>;
  typeCasts?: Record<string, string>;
  chunkSize?: number;
  injectUpdatedAt?: boolean;
}): Promise<Record<string, unknown>[]> {
  const {
    table,
    columns,
    conflictColumns,
    returningColumns,
    rows,
    signal,
    updateOverrides,
    typeCasts,
    chunkSize = BULK_CHUNK_SIZE,
  } = params;
  if (rows.length === 0) return [];

  const { columns: effectiveColumns, rows: effectiveRows } = injectMissingDefaults(columns, rows, { injectUpdatedAt: params.injectUpdatedAt });

  const nonConflictColumns = effectiveColumns.filter(
    (col) => !conflictColumns.includes(col),
  );

  const updateSet = nonConflictColumns
    .map((col) => {
      if (updateOverrides && col in updateOverrides) {
        return `"${col}" = ${updateOverrides[col]}`;
      }
      return `"${col}" = EXCLUDED."${col}"`;
    })
    .join(", ");

  const columnList = effectiveColumns.map((col) => `"${col}"`).join(", ");
  const conflictList = conflictColumns
    .map((col) => `"${col}"`)
    .join(", ");
  const returningList = returningColumns
    .map((col) => `"${col}"`)
    .join(", ");

  const baseSql = `INSERT INTO "${table}" (${columnList}) VALUES %s ON CONFLICT (${conflictList}) DO UPDATE SET ${updateSet} RETURNING ${returningList}`;

  const allResults: Record<string, unknown>[] = [];

  for (let offset = 0; offset < effectiveRows.length; offset += chunkSize) {
    throwIfAborted(signal);
    const chunk = effectiveRows.slice(offset, offset + chunkSize);

    const allValues: unknown[] = [];
    const valueClauses: string[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const rowPlaceholders: string[] = [];
      for (const col of effectiveColumns) {
        allValues.push(row[col] ?? null);
        const cast = typeCasts?.[col];
        rowPlaceholders.push(cast ? `$${paramIdx}::${cast}` : `$${paramIdx}`);
        paramIdx++;
      }
      valueClauses.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = baseSql.replace("%s", valueClauses.join(", "));
    const chunkResult = (await prisma.$queryRawUnsafe(
      sql,
      ...allValues,
    )) as Record<string, unknown>[];
    allResults.push(...chunkResult);
  }

  throwIfAborted(signal);
  return allResults;
}

/**
 * Bulk INSERT ... RETURNING for publish phase (inside $transaction).
 * No ON CONFLICT — publish uses delete-then-recreate pattern.
 */
export async function rawSqlCreateReturning(params: {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  returningColumns: string[];
  tx: Prisma.TransactionClient;
  signal?: AbortSignal;
  typeCasts?: Record<string, string>;
  chunkSize?: number;
  injectUpdatedAt?: boolean;
}): Promise<Record<string, unknown>[]> {
  const {
    table,
    columns,
    rows,
    returningColumns,
    tx,
    signal,
    typeCasts,
    chunkSize = BULK_CHUNK_SIZE,
  } = params;
  if (rows.length === 0) return [];

  const { columns: effectiveColumns, rows: effectiveRows } = injectMissingDefaults(columns, rows, { injectUpdatedAt: params.injectUpdatedAt });

  const columnList = effectiveColumns.map((col) => `"${col}"`).join(", ");
  const returningList = returningColumns
    .map((col) => `"${col}"`)
    .join(", ");

  const baseSql = `INSERT INTO "${table}" (${columnList}) VALUES %s RETURNING ${returningList}`;

  const allResults: Record<string, unknown>[] = [];

  for (let offset = 0; offset < effectiveRows.length; offset += chunkSize) {
    throwIfAborted(signal);
    const chunk = effectiveRows.slice(offset, offset + chunkSize);

    const allValues: unknown[] = [];
    const valueClauses: string[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      const rowPlaceholders: string[] = [];
      for (const col of effectiveColumns) {
        allValues.push(row[col] ?? null);
        const cast = typeCasts?.[col];
        rowPlaceholders.push(cast ? `$${paramIdx}::${cast}` : `$${paramIdx}`);
        paramIdx++;
      }
      valueClauses.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = baseSql.replace("%s", valueClauses.join(", "));
    const chunkResult = (await tx.$queryRawUnsafe(
      sql,
      ...allValues,
    )) as Record<string, unknown>[];
    allResults.push(...chunkResult);
  }

  throwIfAborted(signal);
  return allResults;
}
