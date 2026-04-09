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

Pure presentational components. The first one is `timeline-board.tsx`, which consumes a prepared view model and knows nothing about Jira.

### `src/modules/jira`

Integration boundary with Jira:

- `client.ts` fetches issues from Jira.
- `types.ts` defines the minimum external contract we care about.
- `derive.ts` transforms Jira issue payloads into timeline-friendly fields.

### `src/modules/timeline`

Timeline domain and rendering preparation:

- `types.ts` defines internal view models.
- `build-timeline.ts` turns issues into day grid coordinates.
- `mock-data.ts` keeps the page usable before the sync pipeline is wired to the database.

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

## Recommended MVP milestones

1. Wire Prisma client and migrations.
2. Implement Jira sync into the database.
3. Render the timeline from persisted issue records instead of mock data.
4. Add filtering and performance guardrails for large epics.
