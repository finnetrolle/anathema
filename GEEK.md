# GEEK.md

This file provides guidance to Geek when working with code in this repository.

## Commands

```bash
npm run dev              # Next.js dev server (port 3001 by default)
npm run build            # Production build
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # Vitest unit tests (excludes *.smoke.test.ts)
npm run test:smoke       # Real Postgres-backed smoke tests (needs DB)
npm run check            # All gates: lint + typecheck + test + test:smoke + build

# Run a single test file
npx vitest run src/modules/jira/derive.test.ts

# Database
npm run db:generate      # Regenerate Prisma client after schema changes
npm run db:push          # Push schema to Postgres (no migration files)
npm run db:migrate       # Run Prisma migrations (dev)
npm run db:studio        # Prisma Studio GUI
```

Smoke tests and `npm run check` require a running Postgres (`docker compose up -d postgres`).

## Architecture

Anathema is a Jira timeline analytics MVP. It syncs issues from Jira into Postgres via Prisma, then renders a day-resolution timeline grouped by epics on an SVG/CSS board.

**Stack:** Next.js 15 App Router + TypeScript + Prisma + PostgreSQL + Vitest. Date math uses luxon. No external UI framework.

### Data flow

1. **Jira client** (`src/modules/jira/client.ts`) — auto-detects Cloud vs Server/Data Center, Bearer vs Basic auth, API v2 vs v3, and the legacy "Epic Link" custom field at runtime via probing `/serverInfo`.

2. **Sync pipeline** (`src/modules/jira/persist.ts`) — called from `POST /api/jira/sync`. Uses a two-phase staged approach:
   - **Stage** (`sync-entities.ts`): Fetches issues with changelog from Jira, normalizes into staged tables (`StagedJiraProject`, `StagedEpic`, `StagedAssignee`, `StagedIssue`, `StagedIssueStatusHistory`) scoped to a `SyncRun`.
   - **Publish** (`sync-publish.ts`): In a single transaction, copies staged data into live tables (`JiraProject`, `Epic`, `Issue`, `Assignee`, `IssueStatusHistory`) and cleans up. Supports abort signals.

3. **Dashboard loader** (`src/modules/timeline/load-dashboard.ts`) — server-side function that queries Prisma for all non-epic issues, enriches with raw payload data (component names, dev/PR summaries, assignee history), groups into `TimelineEpic` objects.

4. **Timeline builder** (`src/modules/timeline/build-timeline.ts`) — pure function turning `TimelineEpic[]` into a `TimelineModel` with day-grid columns and positioned row items. Skips weekends.

5. **Timeline board** (`src/components/timeline/timeline-board.tsx`) — presentational React component rendering `TimelineModel` as SVG/CSS grid. Knows nothing about Jira or Prisma.

### Key module boundaries

- `src/modules/jira/` — Jira REST API integration. `types.ts` defines external contract; `derive.ts` extracts timeline-relevant fields (start from changelog, marker from resolution/due, assignee identity/color); `workflow-rules.ts` maps Jira statuses to workflow categories.
- `src/modules/timeline/` — domain logic for timeline visualization. `types.ts` defines view models shared between builder and board. Submodules: `date-helpers`, `timeline-range`, `task-bounds`, `development-summary`, `raw-payload-helpers`, `risk-helpers`.
- `src/modules/auth/` — opt-in Basic Auth + sync endpoint CSRF protection.
- `src/modules/i18n/` — bilingual RU/EN. `config.ts` defines `AppLocale` type and cookie name. Default locale is `ru`.
- `src/modules/db/prisma.ts` — singleton Prisma client with global caching in dev to survive HMR.
- `src/app/` — Next.js App Router pages and API routes.

### Sync endpoint protection

`POST /api/jira/sync` requires: authenticated caller (when Basic Auth enabled), `Content-Type: application/json`, valid JSON body, `X-Anathema-Action: sync` header, and `Origin` matching `APP_BASE_URL`.

### Path alias

`@/*` maps to `./src/*`.

### Test conventions

- Unit tests: `src/**/*.test.ts` — run by `npm run test` (Vitest, node environment).
- Smoke tests: `src/**/*.smoke.test.ts` — excluded from unit test runs, executed by `npm run test:smoke` with a real Postgres schema.
- Vitest config is split between `vitest.config.ts` and `vitest.shared.ts` (shared alias and exclude patterns).

### Database

PostgreSQL with Prisma ORM. Schema at `prisma/schema.prisma`. Models: `JiraConnection`, `JiraProject`, `Epic`, `Issue`, `Assignee`, `IssueStatusHistory`, `SyncRun`, and staged variants (`Staged*`). The `Issue` model stores both normalized timeline fields (`startedAt`, `markerAt`, `markerKind`) and the full `rawPayload` JSON for deferred enrichment. Additional models: `DailyBriefRun`/`DailyBriefItem`, `RiskSnapshot`/`RiskReason`, `RiskThresholdConfig`.
