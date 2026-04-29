# Review Remediation Plan

Last updated: 2026-04-29

This document turns the latest review findings into an execution-ready plan for an AI coding agent. It is optimized for independent, phase-by-phase delivery with clear defaults, acceptance criteria, and verification steps.

## Scope

This plan addresses the main weaknesses identified in the review:

1. No explicit auth boundary for pages and sync endpoints
2. State-changing sync can be triggered too easily
3. Over-retention of Jira payloads and PII
4. Red quality gates and drifting tests
5. Runtime schema mutation on container boot
6. Publish path and read path that will not scale well
7. Large files and mixed responsibilities that slow safe iteration
8. Missing visible security hardening in app/runtime config

## Execution Principles

- Work strictly phase by phase. Do not start the next phase until the current phase meets its acceptance criteria.
- Prefer the recommended defaults below if no human answers are available.
- Keep each phase shippable on its own.
- Add or update tests in the same phase as the code change.
- Do not relax security as a shortcut.
- Update this file’s progress tracker at the end of each completed phase.

## Recommended Defaults

Use these defaults unless a human explicitly chooses a different path:

1. Authentication strategy:
   Use app-level Basic Auth in `middleware.ts` with env vars `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD`.

2. Browser protection for state-changing sync:
   Require all of the following on `POST /api/jira/sync`:
   - authenticated caller
   - `Content-Type: application/json`
   - valid JSON body
   - `Origin` matching `APP_BASE_URL`
   - custom header from the UI such as `X-Anathema-Action: sync`

3. Data minimization strategy:
   Persist a strict allowlisted Jira payload projection and remove assignee email storage unless a documented feature depends on it.

4. Deployment strategy:
   Replace runtime `prisma db push` with reviewed Prisma migrations and `prisma migrate deploy`.

5. Publish redesign target:
   Move toward versioned sync snapshots where publish becomes pointer-switching instead of delete-and-recreate.

## Progress Tracker

- [ ] Phase 1: Access control and sync hardening
- [ ] Phase 2: Restore green quality gates
- [ ] Phase 3: Data minimization and PII reduction
- [ ] Phase 4: Runtime and deployment hardening
- [ ] Phase 5: Scalable sync publish/read architecture
- [ ] Phase 6: File decomposition and maintainability
- [ ] Final verification and documentation pass

## Phase 1: Access Control And Sync Hardening

### Goal

Close the two P0 gaps first:

- no visible auth boundary for `/` and `/issues`
- sync is triggerable by any POST, including malformed payloads

### Files In Scope

- `middleware.ts` or `src/middleware.ts` if preferred by app structure
- `src/app/api/jira/sync/route.ts`
- `src/components/timeline/sync-now-button.tsx`
- `src/app/page.tsx`
- `src/app/issues/page.tsx`
- `src/app/api/health/route.ts`
- `.env.example`
- `README.md`
- new auth helper files under `src/modules/auth/` if useful

### Work Items

1. Add a single explicit auth boundary for all app pages and non-health API routes.
2. Exempt only:
   - `/_next/*`
   - static assets
   - `/api/health`
3. Make sync reject malformed or missing JSON with `400`.
4. Make sync reject wrong content type with `415`.
5. Make sync reject cross-origin or non-UI requests with `403`.
6. Update the sync UI fetch to send the required custom header.
7. Document all new env vars and local setup.

### Acceptance Criteria

- Unauthenticated requests to `/` and `/issues` do not render project data.
- Unauthenticated or forged requests to `/api/jira/sync` fail before any sync work starts.
- A plain HTML form POST to `/api/jira/sync` cannot trigger a sync.
- `POST /api/health` remains unnecessary; `GET /api/health` still works.
- The in-app sync button still works for an authenticated browser session.

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- Add at least one focused test for the sync route request validation path

### AI Task Prompt

Implement Phase 1 from `docs/review-remediation-plan.md`. Use the recommended defaults unless the codebase already has a stronger auth pattern. Finish only Phase 1, including tests and docs, and stop after reporting verification results.

## Phase 2: Restore Green Quality Gates

### Goal

Rebuild trust in the repo by making local quality gates pass again before broader structural work.

### Files In Scope

- `src/modules/timeline/date-helpers.ts`
- `src/modules/timeline/date-helpers.test.ts`
- `src/modules/jira/persist.smoke.test.ts`
- `src/modules/jira/bulk-sql.test.ts`
- `src/modules/jira/sync-entities.test.ts`
- `src/modules/jira/sync-publish.test.ts`
- `src/modules/timeline/raw-payload-helpers.test.ts`
- any production files needed to realign tests with current contracts

### Work Items

1. Fix the `addDaysInTimezone` contract drift:
   - either restore the export with tests
   - or update callers/tests to the new canonical helper
2. Remove or replace stale smoke-test expectations for fields no longer returned by `runJiraSyncChunk`.
3. Align `bulk-sql` tests with current `updatedAt` injection behavior, or change test setup to disable that behavior explicitly.
4. Fix type drift in Jira fixtures and mocked Prisma transactions.
5. Remove unused test imports and similar lint noise.
6. Ensure the repo has one documented standard for local verification.

### Acceptance Criteria

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run test` passes
- if Postgres is available, `npm run test:smoke` passes
- test failures are not hidden with skips unless a clear comment and issue reference explain why

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:smoke` if local Postgres is available

### AI Task Prompt

Implement Phase 2 from `docs/review-remediation-plan.md`. Do not change product behavior unless that is required to reconcile tests with the actual supported contract. Finish with green local quality gates.

## Phase 3: Data Minimization And PII Reduction

### Goal

Reduce the blast radius of a data leak by shrinking what is stored from Jira and removing unnecessary PII.

### Files In Scope

- `src/modules/jira/sync-entities.ts`
- `src/modules/timeline/raw-payload-helpers.ts`
- `src/modules/timeline/dashboard-enrichment.ts`
- `src/modules/timeline/load-dashboard.ts`
- `src/modules/timeline/dashboard-queries.ts`
- `prisma/schema.prisma`
- migration files or migration plan docs
- tests covering raw payload and enrichment behavior
- `README.md`
- `docs/architecture.md`

### Work Items

1. Inventory exactly which `rawPayload` fields are read today by timeline, risk, and issue pages.
2. Create a narrow `StoredJiraIssuePayload` allowlist type and builder.
3. Persist only fields required by:
   - timeline rendering
   - author/assignee history
   - status category
   - component derivation
   - estimate derivation
   - development summary parsing
4. Remove assignee email from the schema and ingestion path unless a documented feature requires it.
5. Add a migration or one-off data backfill strategy:
   - schema migration
   - optional script to trim existing rows
6. Update docs to record the retained Jira fields and the reason each field exists.

### Acceptance Criteria

- `rawPayload` is a documented allowlist, not a full Jira issue dump.
- Assignee email is no longer stored unless justified in writing.
- Timeline and issue views still render correctly using the minimized payload.
- Tests cover the new stored payload contract.

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- targeted smoke validation of sync + dashboard if Postgres is available

### AI Task Prompt

Implement Phase 3 from `docs/review-remediation-plan.md`. Preserve current user-facing behavior while shrinking stored Jira data to the minimum needed by the app. Update schema, ingestion, tests, and architecture docs in one cohesive phase.

## Phase 4: Runtime And Deployment Hardening

### Goal

Move the app from MVP runtime defaults toward safer deployment defaults.

### Files In Scope

- `Dockerfile`
- `package.json`
- `next.config.ts`
- `src/app/layout.tsx`
- optional new security helper or middleware files
- `.env.example`
- `README.md`
- deployment docs

### Work Items

1. Replace `prisma db push` on container boot with a migration-based flow.
2. Make the Docker image production-oriented:
   - prefer a multi-stage build
   - run as non-root where practical
   - keep only runtime dependencies in the final image
3. Add visible security headers.
   Recommended minimum:
   - `Content-Security-Policy`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy`
   - clickjacking protection via `frame-ancestors` or `X-Frame-Options`
4. Because the app currently uses an inline theme bootstrap script, either:
   - move it to a safer pattern compatible with CSP
   - or introduce a nonce-based CSP strategy
5. Document the production startup contract:
   - migrations happen before app start
   - required env vars
   - health endpoint semantics

### Acceptance Criteria

- The container no longer mutates schema shape at runtime with `db push`.
- The app can boot from a migrated database using production startup commands.
- Security headers are visible in app config or middleware.
- The theme bootstrap still works without silently weakening CSP.

### Verification

- `npm run build`
- verify startup command path in docs
- inspect headers in local or test environment if feasible

### AI Task Prompt

Implement Phase 4 from `docs/review-remediation-plan.md`. Use `prisma migrate deploy` as the default deployment path, and add visible app-level security hardening without breaking the theme bootstrap behavior.

## Phase 5: Scalable Sync Publish And Read Architecture

### Goal

Remove the main scale bottleneck: publish currently loads staged data into memory, deletes live data, and recreates it inside a single transaction.

### Target Direction

Move from delete-and-recreate publishing to versioned sync snapshots:

- sync writes remain isolated per `SyncRun`
- a successful publish updates a small pointer such as `JiraConnection.activeSyncRunId`
- read paths query only data for the active successful sync
- publish becomes a metadata switch, not a full data rewrite

### Files In Scope

- `prisma/schema.prisma`
- `src/modules/jira/persist.ts`
- `src/modules/jira/sync-publish.ts`
- `src/modules/timeline/load-dashboard.ts`
- `src/modules/timeline/dashboard-queries.ts`
- any query helpers and tests affected by the redesign
- `docs/architecture.md`

### Work Items

1. Design the versioned read model.
   Recommended default:
   - keep staged/versioned entities keyed by `syncRunId`
   - mark one sync run as active per connection
   - query the active run instead of copying data into separate live tables
2. Implement the schema changes needed for the active-pointer model.
3. Convert timeline and issue queries to the active-run model.
4. Replace delete/recreate publish with:
   - validation
   - lock
   - metadata switch
5. Add tests for:
   - active run switching
   - stale run rejection
   - correct reads after publish
   - failed publish leaving previous active data untouched

### Acceptance Criteria

- Publish no longer recreates entire connection datasets in one large transaction.
- Reads resolve against the active successful sync.
- A failed publish cannot wipe the previously visible dataset.
- Sync concurrency rules remain enforced.

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- focused smoke test for multi-chunk sync and publish flow

### AI Task Prompt

Implement Phase 5 from `docs/review-remediation-plan.md`. Favor the active-sync pointer design so publish becomes a lightweight metadata switch. Preserve current UI behavior while reducing transaction size and memory pressure.

## Phase 6: File Decomposition And Maintainability

### Goal

Make the codebase easier to change safely after the functional and security fixes are in place.

### Inputs

- `REFACTOR_PLAN.md`
- current large files:
  - `src/modules/jira/client.ts`
  - `src/modules/jira/persist.ts`
  - `src/modules/timeline/load-dashboard.ts`
  - `src/modules/timeline/build-timeline.ts`
  - `src/components/timeline/timeline-board.tsx`

### Work Items

1. Complete the extraction steps already outlined in `REFACTOR_PLAN.md`.
2. For each large file, separate:
   - orchestration
   - parsing/mapping
   - query building
   - pure domain helpers
   - UI rendering subcomponents
3. Keep public module APIs small and documented.
4. Add tests at newly extracted boundaries rather than only at the top level.

### Acceptance Criteria

- The current god files are materially smaller.
- New helper modules have focused responsibilities.
- Refactoring does not re-break quality gates.
- `REFACTOR_PLAN.md` is either completed or replaced by updated docs.

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`

### AI Task Prompt

Implement Phase 6 from `docs/review-remediation-plan.md` and use `REFACTOR_PLAN.md` as the detailed extraction guide where it still applies. Keep changes behavior-preserving and test-backed.

## Final Verification And Documentation Pass

### Goal

End with a repo that is not only safer, but also easier for the next AI or engineer to continue.

### Work Items

1. Run the full available verification set.
2. Update:
   - `README.md`
   - `docs/architecture.md`
   - `.env.example`
   - this plan’s progress tracker
3. Add a short “operating model” section describing:
   - auth model
   - sync safety model
   - retained Jira data
   - deployment model
4. If any intentional tradeoffs remain, list them explicitly under “Known Limitations”.

### Final Verification Commands

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:smoke` if local Postgres is available
- `npm run check` once the environment is capable of running all sub-steps reliably

### Final AI Task Prompt

Complete the final verification and documentation pass from `docs/review-remediation-plan.md`. Do not introduce new features. Focus on validation, doc accuracy, and recording any residual limitations honestly.

## Notes For Future Executors

- If the environment already has a trusted upstream auth gateway, keep app-level checks anyway until the gateway contract is documented in repo code and docs.
- If Phase 5 is too large for one change, split it into:
  - Phase 5A: schema and active-pointer groundwork
  - Phase 5B: query migration
  - Phase 5C: delete/recreate publish removal
- Do not skip Phase 2. Security work without green tests will remain fragile.
