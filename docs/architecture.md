# MVP Architecture

## Why this structure

The application needs three distinct responsibilities from day one:

1. Fetch unstable Jira data and normalize it into a predictable domain model.
2. Store enough history to rebuild a timeline quickly without re-querying Jira for every page view.
3. Render a purpose-built timeline instead of forcing the problem into a generic Gantt widget.

## Folder responsibilities

### `src/app`

Route entrypoints, server-rendered pages, API routes, and app-level metadata.

### `src/components`

UI components that stay on the presentation and interaction side of the boundary.
`timeline-board.tsx` consumes a prepared view model and knows nothing about Jira
or Prisma.

### `src/modules/jira`

Integration boundary with Jira:

- `client.ts` fetches issues from Jira.
- `types.ts` defines the minimum external contract we care about.
- `derive.ts` transforms Jira issue payloads into timeline-friendly fields.

### `src/modules/timeline`

Timeline domain and rendering preparation:

- `types.ts` defines internal view models.
- `load-dashboard.ts` reads persisted issue data and prepares the dashboard view
  model.
- `build-timeline.ts` turns issues into day grid coordinates.

### `prisma/schema.prisma`

Persistence layer for:

- Jira connection metadata
- tracked projects
- epics
- issues
- assignees
- sync runs
- issue status history

## Data model notes

### `JiraConnection`

Represents one Jira workspace and the credentials/config needed to sync it.

### `JiraProject`

Keeps the set of Jira projects we pull into the app and allows per-project filtering.

### `Epic`

A stable container for issue grouping on the Y axis.

### `Issue`

Stores the latest known issue state together with normalized timeline fields:

- `startedAt`
- `markerAt`
- `markerKind`

These fields are derived from changelog history and due dates so the UI can query them directly.

### `IssueStatusHistory`

Stores every observed status transition to make recalculation deterministic when business rules change.

### `SyncRun`

Lets us audit syncs, detect failures, and later support incremental refreshes.

## Strengths worth preserving

These qualities already give the project a strong foundation and should stay
intact during further iteration:

1. Clear module boundaries separate Jira integration, persistence, timeline
   preparation, and UI rendering, which keeps changes localized.
2. The Jira adapter owns compatibility concerns such as Cloud vs Server,
   bearer vs basic auth, API v2 vs v3, and legacy epic-link detection instead
   of leaking them across the app.
3. The persistence model stores both normalized timeline fields and the raw
   Jira payload, which keeps reads fast today without giving up future
   recalculation or enrichment options.
4. The UI renders from internal timeline view models rather than Prisma or Jira
   records directly, which makes the board easier to evolve safely.
5. `SyncRun` and `IssueStatusHistory` give the project a real operational trail
   instead of treating sync as a blind fire-and-forget import.

## Current engineering priorities

1. Make sync results atomic or versioned so failed chunked imports do not leave
   the board in a partially refreshed state.
2. Push filtering and range narrowing closer to the database so the dashboard
   does not have to hydrate every issue into memory on each request.
3. Move workflow-specific status and timezone rules out of hardcoded defaults
   and into configuration tied to the Jira connection.
4. Add automated quality gates for build, lint, and a small set of sync and
   timeline tests.
