# Efficiency Review -- anathema

## Dead / Orphan Files

**None found.** Every non-test file is either an entry point (page, route, layout) or imported by at least one other file. Orphan remnants from deleted `daily-brief` and `risk-radar` modules have been fully cleaned up. `risk-helpers.ts` is an intentional inline of the deleted risk-radar module and is fully integrated.

## Issues

### HIGH -- Repeated rawPayload parsing in `load-dashboard.ts`

Inside `toTimelineEpics()`, the same `rawPayload` JSON is parsed 8+ times per issue by separate calls to: `deriveComponentName`, `deriveAuthorName`, `deriveAssigneeHistory`, `deriveObservedPeople` (which internally re-calls `deriveAssigneeHistory`), `deriveDevelopmentSummary`, `deriveEstimateHours`, `deriveEstimateStoryPoints`, `deriveStatusCategoryKey`. A single pre-parsed pass would eliminate the duplication.

### MEDIUM -- `toPrismaJson` does JSON.stringify + JSON.parse as deep clone

`persist.ts` lines 137-139. Called for every issue on every sync page. Full serialize/deserialize just to deep-clone the payload object.

### MEDIUM -- Sequential DB upserts in `persistIssues` and `publishSyncRun`

`persist.ts`: The issue loop does individual sequential upserts for project, assignee, epic, issue, and each status transition. `publishSyncRun` creates published records one-by-one inside a transaction instead of batching with `createMany` where possible (projects, assignees).

### LOW -- Unbounded module-level Sets/Maps

- `warnedFallbackConnections` in `workflow-rules.ts` (line 32): grows indefinitely per unique connectionId.
- `DATE_FORMATTER_CACHE` in `date-helpers.ts` (line 12): keyed by `${locale}:${timezone}`, unbounded if timezones vary.

### LOW -- Duplicate utility functions

- `firstQueryValue` is identically defined in `src/app/page.tsx` (line 23) and `src/app/issues/page.tsx` (line 108).
- `isAbortError` exists in both `src/modules/jira/abort.ts` and `src/components/timeline/sync-now-button.tsx` (intentional client/server split, but worth a shared comment).

### LOW -- Broad query for project filter options

`load-dashboard.ts` line 1213: `prisma.jiraProject.findMany()` loads all projects without limit to populate the filter dropdown. Acceptable for MVP but will degrade at scale.
