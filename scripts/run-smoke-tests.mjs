import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCliPath = resolve(rootDir, "node_modules/prisma/build/index.js");
const vitestCliPath = resolve(rootDir, "node_modules/vitest/vitest.mjs");
const lockedEnvKeys = new Set(Object.keys(process.env));

function parseEnvValue(rawValue) {
  const trimmedValue = rawValue.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function loadEnvFile(fileName) {
  const filePath = resolve(rootDir, fileName);

  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();

    if (!key || lockedEnvKeys.has(key)) {
      continue;
    }

    process.env[key] = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
  }
}

function buildSmokeDatabaseUrl(baseUrl, schemaName) {
  const url = new URL(baseUrl);

  url.searchParams.set("schema", schemaName);

  return url.toString();
}

function runNodeScript(scriptPath, args, env) {
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const baseDatabaseUrl = process.env.DATABASE_URL;

if (!baseDatabaseUrl) {
  throw new Error(
    "DATABASE_URL is required for smoke tests. Start Postgres with `docker compose up -d postgres` and ensure `.env` contains DATABASE_URL.",
  );
}

const smokeSchemaName = `smoke_${Date.now()}_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
const smokeDatabaseUrl = buildSmokeDatabaseUrl(baseDatabaseUrl, smokeSchemaName);
const cleanupClient = new PrismaClient({
  datasourceUrl: baseDatabaseUrl,
  log: ["error"],
});

let smokeError = null;

try {
  await cleanupClient.$connect();
  await cleanupClient.$executeRawUnsafe(
    `CREATE SCHEMA IF NOT EXISTS "${smokeSchemaName}"`,
  );

  const childEnv = {
    ...process.env,
    DATABASE_URL: smokeDatabaseUrl,
    NODE_ENV: "test",
  };

  runNodeScript(prismaCliPath, ["db", "push", "--skip-generate"], childEnv);
  runNodeScript(vitestCliPath, ["run", "--config", "vitest.smoke.config.ts"], childEnv);
} catch (error) {
  smokeError = error;
} finally {
  try {
    await cleanupClient.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${smokeSchemaName}" CASCADE`,
    );
  } finally {
    await cleanupClient.$disconnect();
  }
}

if (smokeError) {
  throw smokeError;
}
