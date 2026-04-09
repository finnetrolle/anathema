# CLAUDE.md

This file provides guidance to Geek when working with code in this repository.

## Commands

```bash
npm run dev              # Start Next.js dev server
npm run build            # Production build
npm run db:generate      # Regenerate Prisma client after schema changes
npm run db:push          # Push schema to Postgres (no migration files)
npm run db:migrate        # Run Prisma migrations (dev)
npm run db:studio        # Open Prisma Studio browser GUI
```

No linter, formatter, or test runner is configured yet.

## Architecture

Anathema is a Jira timeline analytics MVP. It syncs issues from Jira into Postgres via Prisma, then renders a day-resolution timeline grouped by epics on a custom SVG/CSS board.

### Data flow

1. **Jira client** (`src/modules/jira/client.ts`) — auto-detects Cloud vs Server/Data Center, Bearer vs Basic auth, API v2 vs v3, and the legacy "Epic Link" custom field. Credentials come from env vars (see `.env.example`). Resolution happens at runtime via probing `/serverInfo`.

2. **Sync pipeline** (`src/modules/jira/persist.ts`) — called from `POST /api/jira/sync`. Creates a `SyncRun`, fetches issues with changelog, and upserts projects, epics, assignees, issues, and status transitions. Supports abort signals.

3. **Dashboard loader** (`src/modules/timeline/load-dashboard.ts`) — server-side function that queries Prisma for all non-epic issues, enriches them with raw payload data (component names, development/PR summaries, assignee history), groups into `TimelineEpic` objects, and feeds them into the timeline builder.

4. **Timeline builder** (`src/modules/timeline/build-timeline.ts`) — pure function turning `TimelineEpic[]` into a `TimelineModel` with day-grid columns and positioned row items. Skips weekends. Default range: current week + 15 days.

5. **Timeline board** (`src/components/timeline/timeline-board.tsx`) — presentational React component that renders the `TimelineModel` as an SVG/CSS grid. Knows nothing about Jira or Prisma.

### Key module boundaries

- `src/modules/jira/` — integration boundary with Jira REST API. `types.ts` defines the external contract; `derive.ts` extracts timeline-relevant fields (start date from changelog, marker from resolution/due date, assignee identity/color).
- `src/modules/timeline/` — domain logic for the timeline visualization. `types.ts` defines internal view models used by both the builder and the board component.
- `src/modules/db/prisma.ts` — singleton Prisma client with global caching in dev to survive HMR.
- `src/app/` — Next.js App Router pages and API routes.

### Database

PostgreSQL with Prisma ORM. Key models: `JiraConnection`, `JiraProject`, `Epic`, `Issue`, `Assignee`, `IssueStatusHistory`, `SyncRun`. The `Issue` model stores both normalized timeline fields (`startedAt`, `markerAt`, `markerKind`) and the full `rawPayload` JSON for deferred enrichment.

### Path alias

`@/*` maps to `./src/*`.
