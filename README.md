# Anathema

MVP for analyzing the current state of Jira and projecting issues on a day-based timeline grouped by epics.

## Stack

- Next.js App Router + TypeScript
- Prisma + PostgreSQL
- Jira REST API integration layer
- Custom SVG/CSS timeline optimized for epic grouping

The Jira client auto-detects:

- Jira Cloud vs Jira Server/Data Center
- `Bearer` PAT auth vs `Basic email:token`
- API version `2` vs `3`
- legacy `Epic Link` field when the instance does not expose epic relationships via `parent`

## Repository layout

```text
.
|-- docs/
|   `-- architecture.md
|-- prisma/
|   `-- schema.prisma
|-- src/
|   |-- app/
|   |   |-- api/
|   |   |   |-- health/route.ts
|   |   |   `-- jira/sync/route.ts
|   |   |-- globals.css
|   |   |-- layout.tsx
|   |   `-- page.tsx
|   |-- components/
|   |   `-- timeline/timeline-board.tsx
|   `-- modules/
|       |-- jira/
|       |   |-- client.ts
|       |   |-- derive.ts
|       |   `-- types.ts
|       `-- timeline/
|           |-- build-timeline.ts
|           |-- mock-data.ts
|           `-- types.ts
|-- .env.example
|-- docker-compose.yml
`-- package.json
```

## MVP flow

1. Pull epic and issue data from Jira using JQL.
2. Normalize issue history into timeline fields:
   - start of work = first transition into an "in progress" status
   - end marker = resolution date for done issues, due date for open issues
3. Persist the raw and normalized data in PostgreSQL.
4. Render an epic-by-epic timeline with day resolution and assignee color coding.

## Local start

```bash
cp .env.example .env
docker compose up -d
```

The application will be available at [http://localhost:3001](http://localhost:3001) by default, and Postgres will be exposed on `localhost:5432`.

## Local development without Docker for the app

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:push
npm run dev
```

## Next implementation steps

- connect Prisma client and sync runs to the `/api/jira/sync` route
- store Jira changelog snapshots in the database
- add filters for assignee, epic, status, and visible time range
- expand the timeline UI with hover details and explicit empty states
