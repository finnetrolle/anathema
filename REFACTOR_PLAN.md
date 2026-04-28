# God-File Refactoring Plan

Test runner: `npx vitest run` (config in `vitest.config.ts`, alias `@` → `./src/*`).
After each step: `npx vitest run && npx tsc --noEmit`.

Each step is self-contained. If interrupted, find the last completed step and resume from the next.

---

## Progress Tracker

- [ ] Step 1: persist.ts — extract bulk SQL helpers
- [ ] Step 2: persist.ts — extract entity collection
- [ ] Step 3: persist.ts — extract sync orchestration
- [ ] Step 4: dashboard-enrichment.ts — extract JSON/development parsing
- [ ] Step 5: dashboard-enrichment.ts — extract field derivation helpers
- [ ] Step 6: build-timeline.ts — extract range/column helpers
- [ ] Step 7: build-timeline.ts — deduplicate buildRowItem
- [ ] Final: verify all tests pass, full build

---

## Step 1: persist.ts — extract bulk SQL helpers

**Status: pending**

### What moves

Extract from `src/modules/jira/persist.ts` into new file `src/modules/jira/bulk-sql.ts`:

- Type `BULK_CHUNK_SIZE` constant (line 272)
- `bulkUpsertReturning()` (lines 279-355) — bulk INSERT...ON CONFLICT...RETURNING
- `rawSqlCreateReturning()` (lines 361-411) — bulk INSERT...RETURNING (inside transaction)

Both functions depend on `prisma` (from `@/modules/db/prisma`) and `throwIfAborted` (from `@/modules/jira/abort`). They do NOT depend on any other persist.ts internals.

### Test-first approach

1. **Create** `src/modules/jira/bulk-sql.test.ts`
2. **Test `bulkUpsertReturning`**: mock `prisma.$queryRawUnsafe` to verify:
   - Correct SQL template: `INSERT INTO "Table" (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ... RETURNING ...`
   - Parameter values match row data
   - Chunking: with `BULK_CHUNK_SIZE = 500`, rows >500 produce multiple calls
   - Empty rows → returns `[]`
   - `updateOverrides`: custom SET expression is used
   - `typeCasts`: `$1::jsonb` syntax
3. **Test `rawSqlCreateReturning`**: same style but:
   - No ON CONFLICT clause
   - Uses `tx.$queryRawUnsafe` instead of `prisma.$queryRawUnsafe`
   - Empty rows → returns `[]`
4. **Run tests**: `npx vitest run src/modules/jira/bulk-sql.test.ts` — must pass
5. **Extract**: move functions to `bulk-sql.ts`, update imports in `persist.ts`
6. **Verify**: `npx vitest run && npx tsc --noEmit` — all pass

### Imports after extraction

```ts
// persist.ts
import { bulkUpsertReturning, rawSqlCreateReturning } from "@/modules/jira/bulk-sql";
```

---

## Step 2: persist.ts — extract entity collection

**Status: pending**

### What moves

Extract from `src/modules/jira/persist.ts` into new file `src/modules/jira/sync-entities.ts`:

Types:
- `ProjectSeed` (line 75)
- `EpicSeed` (line 81)
- `CollectedTransition` (line 413)

Pure functions (no DB access):
- `readEpicLinkKey()` (line 89)
- `parseJiraDate()` (line 107)
- `toPrismaJson()` (line 126)
- `buildRawPayload()` (line 130)
- `toPrismaMarkerKind()` (line 144)
- `isEpicIssue()` (line 155)
- `buildProjectSeed()` (line 159)
- `buildEpicSeed()` (line 169)
- `buildEpicLookup()` (line 193)
- `buildLinkedEpicSeed()` (line 206)
- `isPlaceholderEpicId()` (line 238)
- `isPlaceholderEpicSummary()` (line 242)
- `mergeEpicSeeds()` (line 248)
- `collectEntities()` (lines 421-546)

### Test-first approach

1. **Create** `src/modules/jira/sync-entities.test.ts`
2. **Test pure functions** with deterministic JiraIssue fixtures:
   - `readEpicLinkKey`: string value, object with `.key`, null field → returns correct key or null
   - `parseJiraDate`: ISO date string, date-only `YYYY-MM-DD`, null → correct Date or null
   - `buildRawPayload`: includes `__anathemaMeta` with field IDs
   - `toPrismaMarkerKind`: "DONE"/"DUE"/"NONE" → Prisma enum values
   - `isEpicIssue`: issuetype "Epic" → true, "Task" → false
   - `buildProjectSeed`: extracts project.id, project.key, project.name; fallback to key prefix
   - `buildEpicSeed`: for epic issue → returns seed; for task with parent → returns parent seed; no parent → null
   - `buildEpicLookup`: from mixed issues → Map with only epic issues, keyed by id and key
   - `mergeEpicSeeds`: placeholder jiraEpicId replaced by real one; "Unknown" status replaced
   - `collectEntities`: given 3 issues (1 epic + 2 tasks) → returns correct projectMap, assigneeMap, epicMap, issueRecords, transitionRecords
3. **Run tests**: must pass
4. **Extract**: move all to `sync-entities.ts`, update imports in `persist.ts`
5. **Verify**: `npx vitest run && npx tsc --noEmit`

---

## Step 3: persist.ts — extract sync orchestration

**Status: pending**

### What moves

Extract from `src/modules/jira/persist.ts` into new file `src/modules/jira/sync-publish.ts`:

DB-dependent functions:
- `acquireJiraConnectionLock()` (line 780)
- `cleanupStagedSyncRun()` (line 764)
- `publishSyncRun()` (lines 789-1136)
- `failSyncRun()` (lines 1138-1171)
- `upsertJiraConnection()` (lines 740-762)

Keep in `persist.ts`:
- Types: `RunJiraSyncInput`, `RunJiraSyncChunkInput`, `SyncCounts`, `SyncSummaryFragment`, `PersistIssuesResult`, `RunJiraSyncChunkResult`
- `persistIssues()` (orchestrates collect + bulk upsert, imports from sync-entities + bulk-sql)
- `runJiraSyncChunk()` (public export)
- `runJiraSync()` (public export)

### Test-first approach

1. **Create** `src/modules/jira/sync-publish.test.ts`
2. **Test `acquireJiraConnectionLock`**: mock `tx.$queryRaw` → verify `pg_advisory_xact_lock(hashtext(...))` called
3. **Test `cleanupStagedSyncRun`**: mock `tx.stagedJiraProject.deleteMany` + `tx.stagedAssignee.deleteMany` → verify called with `{ where: { syncRunId } }`
4. **Test `upsertJiraConnection`**: mock `prisma.jiraConnection.upsert` → verify where/create/update params
5. **Test `failSyncRun`**: mock transaction → verify status set to FAILED, cleanupStagedSyncRun called
6. **Test `publishSyncRun`** (integration-style with mocked transaction):
   - Happy path: staged data → live tables populated → staged cleaned → status SUCCEEDED
   - Error: stale sync run → throws
   - Error: newer run exists → throws
   - Error: FK integrity violation → throws
7. **Run tests**: must pass
8. **Extract**: move functions to `sync-publish.ts`, update imports in `persist.ts`
9. **Verify**: `npx vitest run && npx tsc --noEmit`

### persist.ts final structure (~300 lines)

```
imports from bulk-sql, sync-entities, sync-publish, client, abort, derive
types: RunJiraSyncInput, SyncCounts, etc.
persistIssues() — Phase A (collectEntities) + Phase B (bulkUpsertReturning x5) + Phase C (result)
runJiraSyncChunk() — public, orchestrates resolveConfig + persist + publish
runJiraSync() — public, loops over chunks
```

---

## Step 4: dashboard-enrichment.ts — extract JSON/development parsing

**Status: pending**

### What moves

Extract from `src/modules/timeline/dashboard-enrichment.ts` into new file `src/modules/timeline/development-summary.ts`:

Types:
- `DerivedDevelopmentSummary` (line 43)
- `EMPTY_DEVELOPMENT_SUMMARY` constant (line 49)

Development field parsing (all pure functions):
- `parseJsonValue()` (line 118)
- `extractEmbeddedJsonValue()` (line 136)
- `readCountLike()` (line 200)
- `normalizePullRequestStatus()` (line 210)
- `derivePullRequestStatusFromCounters()` (line 226)
- `derivePullRequestCount()` (line 246)
- `mergePullRequestStatus()` (line 261)
- `hasDevelopmentSummary()` (line 280)
- `mergeDevelopmentSummaries()` (line 284)
- `readSummaryNode()` (line 302)
- `readTargetsSummary()` (line 356)
- `looksLikeDevelopmentFieldValue()` (line 438)
- `readDevelopmentFieldValue()` (line 462)
- `deriveDevelopmentSummary()` (line 490) — the main BFS traversal

### Test-first approach

1. **Create** `src/modules/timeline/development-summary.test.ts`
2. **Test `extractEmbeddedJsonValue`**: string with `devSummaryJson={...}` → extracts JSON; no marker → null; malformed braces → null; nested strings with escaped quotes → correct extraction
3. **Test `readCountLike`**: number → number; string "5" → 5; array [1,2,3] → 3; null → null
4. **Test `normalizePullRequestStatus`**: "OPEN"/"MERGED"/"DECLINED" (case-insensitive) → correct; "UNKNOWN" → null
5. **Test `mergePullRequestStatus`**: OPEN beats MERGED beats DECLINED beats NONE
6. **Test `readSummaryNode`**: record with `pullrequest.overall` + `commit.overall` → correct summary; null/empty → null
7. **Test `readTargetsSummary`**: Cloud-style `targets` structure with pullrequest + repository entries → correct counts
8. **Test `deriveDevelopmentSummary`** (main integration):
   - null payload → EMPTY_DEVELOPMENT_SUMMARY
   - String field with embedded JSON → parses and extracts
   - Nested `cachedValue.json.summary` structure → correct traversal
   - Multiple PR statuses → OPEN takes priority
   - Cycle in JSON structure → doesn't hang (cycle detection via visitedObjects)
9. **Run tests**: must pass
10. **Extract**: move all to `development-summary.ts`, update exports/imports in `dashboard-enrichment.ts`
11. **Verify**: `npx vitest run && npx tsc --noEmit`

---

## Step 5: dashboard-enrichment.ts — extract field derivation helpers

**Status: pending**

### What moves

Extract from `src/modules/timeline/dashboard-enrichment.ts` into new file `src/modules/timeline/raw-payload-helpers.ts`:

Generic helpers:
- `RawPayloadUser` type (line 6)
- `RawPayloadIssue` type (line 10)
- `readRawPayload()` (line 78)
- `toRecord()` (line 86)
- `readNumericValue()` (line 94)
- `parseDerivedDate()` (line 108)
- `buildIssueUrl()` (line 63)
- `splitComponentNames()` (line 71)

Field-specific derivation (pure functions on rawPayload):
- `deriveAuthorName()` (line 565)
- `deriveStatusCategoryKey()` (line 575)
- `deriveEstimateHours()` (line 587)
- `deriveEstimateStoryPoints()` (line 596)
- `sortChangelogHistories()` (line 581)
- `deriveAssigneeHistory()` (line 611)
- `deriveObservedPeople()` (line 654)
- `deriveComponentName()` (line 689)

Keep in `dashboard-enrichment.ts`:
- `getTimelinePlaceholderCopy()` (used by multiple consumers)
- Re-exports from `raw-payload-helpers.ts` and `development-summary.ts` if needed for backward compatibility

### Test-first approach

1. **Create** `src/modules/timeline/raw-payload-helpers.test.ts`
2. **Test `readRawPayload`**: valid object → returns it; array → null; null → null; primitive → null
3. **Test `toRecord`**: object → returns it; array → null; null → null
4. **Test `readNumericValue`**: number 42 → 42; string "3.5" → 3.5; NaN → null; "abc" → null
5. **Test `parseDerivedDate`**: ISO string → Date; null → null; invalid → null
6. **Test `buildIssueUrl`**: "https://jira.example.com" + "PROJ-1" → "...com/browse/PROJ-1"; null baseUrl → null; trailing slash stripped
7. **Test `splitComponentNames`**: "A, B, C" → ["A","B","C"]; "" → []; "A" → ["A"]
8. **Test `deriveAuthorName`**: payload with creator → creator name; without creator but with reporter → reporter name; neither → null
9. **Test `deriveStatusCategoryKey`**: payload with status.statusCategory.key → key; missing → null
10. **Test `deriveEstimateHours`**: timeoriginalestimate 3600 → 1; only aggregatetimeoriginalestimate → fallback; neither → null
11. **Test `deriveEstimateStoryPoints`**: configured fieldId with value → value; no configured fieldIds → null
12. **Test `deriveAssigneeHistory`**: changelog with assignee transitions → ordered unique names; "Unassigned" filtered; duplicates filtered
13. **Test `deriveObservedPeople`**: combines assignee history + current assignee + creator + reporter → unique ordered list
14. **Test `deriveComponentName`**: fields.components → joined names; no components but changelog Component change → latest value; neither → "No component"
15. **Run tests**: must pass
16. **Extract**: move all to `raw-payload-helpers.ts`, re-export from `dashboard-enrichment.ts`
17. **Verify**: `npx vitest run && npx tsc --noEmit`

---

## Step 6: build-timeline.ts — extract range/column helpers

**Status: pending**

### What moves

Extract from `src/modules/timeline/build-timeline.ts` into new file `src/modules/timeline/timeline-range.ts`:

Types:
- `TimelineRangeOptions` (line 41)
- `TimelineDateBounds` (line 49)
- `TimelineResolvedRange` (line 56)

Range resolution (pure functions + date-helpers):
- `resolveTimezones()` (line 98)
- `getDefaultDayKeyRange()` (line 106)
- `getVisibleStartForDayKey()` (line 125)
- `getVisibleEndForDayKey()` (line 131)
- `getBoundDayKey()` (line 143)
- `getDefaultTimelineRange()` (line 159)
- `normalizeDayWidth()` (line 179)
- `resolveTimelineRange()` (line 197)

Column creation:
- `createColumns()` (line 243)
- `createColumnIndex()` (line 278)

Constants:
- `DEFAULT_DAY_WIDTH`, `MIN_DAY_WIDTH`, `MAX_DAY_WIDTH`, `DEFAULT_RANGE_SPAN_IN_DAYS`

Keep in `build-timeline.ts`:
- `assertDate()`, `collectDateBounds()` (used by buildTimelineModel)
- `findWorkdayInRange()`, `findNearestWorkday()` (used by buildRowItem)
- `createMarkerLabel()`, `createDateLabel()`, `createStartLabel()` (used by buildRowItem)
- `resolveIssueDates()` (used by buildRowItem)
- `buildRowItem()` (to be cleaned in Step 7)
- `buildRows()`, `buildLegend()`, `collectTimelineTimezones()`
- `buildTimelineModel()` (public export)

### Test-first approach

1. **Create** `src/modules/timeline/timeline-range.test.ts`
2. **Test `normalizeDayWidth`**: 100 → 100; 10 → 48 (MIN_DAY_WIDTH); 300 → 240 (MAX_DAY_WIDTH); NaN → 120 (DEFAULT); "80" → 80
3. **Test `getDefaultTimelineRange`**: returns valid start/end day keys, visibleStart < visibleEnd
4. **Test `resolveTimelineRange`**:
   - Default (no options) → uses getDefaultDayKeyRange
   - Custom rangeStart/rangeEnd → uses those day keys
   - Invalid rangeStart → falls back to data bounds or default
   - rangeEnd before rangeStart → rangeEnd clamped to rangeStart
   - Custom dayWidth → normalized
5. **Test `createColumns`**: start="2026-04-27" (Sunday) to "2026-05-01" (Friday) → skips weekends, correct labels, isToday flag
6. **Test `createColumnIndex`**: 3 columns → Map with dayKey → 1,2,3
7. **Run tests**: must pass
8. **Extract**: move all to `timeline-range.ts`, update imports in `build-timeline.ts`
9. **Verify**: `npx vitest run && npx tsc --noEmit`

---

## Step 7: build-timeline.ts — deduplicate buildRowItem

**Status: pending**

### Problem

`buildRowItem()` (lines 396-571) has two nearly identical branches returning `TimelineRowItem`:
1. **Fallback branch** (lines 447-512): `!displayStartDayKey || !displayEndDayKey` → span=1, single column
2. **Normal branch** (lines 515-570): startColumn + markerColumn → span = markerColumn - startColumn + 1

Both branches construct the same ~30-field object with identical field values, differing only in `startColumn` and `span`.

### Test-first approach

1. **Read existing** `src/modules/timeline/build-timeline.test.ts` — understand current coverage
2. **Add tests** for `buildRowItem` edge cases (if not already covered):
   - Issue with dates before visible range → returns null
   - Issue with dates after visible range → returns null
   - Issue spanning weekends → correct clipping
   - Issue with both start and end on same day → span=1
   - Issue with all dates on weekend → fallback to nearest workday, span=1
   - Normal multi-day issue → correct startColumn and span
   - All label fields populated correctly (markerLabel, startLabel, dueLabel, etc.)
3. **Run tests**: must pass before refactoring
4. **Refactor**: Extract a shared `buildRowItemBase()` that constructs all common fields, then compute `startColumn` and `span` in the two branches:

```ts
function buildRowItemBase(issue, dates, epicComponentName, locale) {
  return {
    issueId: issue.id,
    issueKey: issue.key,
    summary: issue.summary,
    // ... all 30 fields except startColumn and span
  };
}

// In buildRowItem:
const base = buildRowItemBase(issue, { markerDate, createdDate, ... }, epicComponentName, locale);
// fallback: return { ...base, startColumn: column, span: 1 };
// normal:   return { ...base, startColumn, span };
```

5. **Run tests**: `npx vitest run` — must pass (behavior unchanged)
6. **Verify**: `npx tsc --noEmit`

---

## Final: verify everything

1. `npx vitest run` — all unit tests pass
2. `npx tsc --noEmit` — no type errors
3. `npx eslint .` — no new warnings
4. `npx next build` — production build succeeds
5. Check that all public exports are preserved:
   - `persist.ts` → `runJiraSync`, `runJiraSyncChunk`
   - `build-timeline.ts` → `buildTimelineModel`, `getDefaultTimelineRange`, `normalizeDayWidth`, `resolveTimelineRange`
   - `dashboard-enrichment.ts` → `deriveDevelopmentSummary`, `deriveComponentName`, `deriveAssigneeHistory`, `deriveObservedPeople`, `readRawPayload`, etc.

---

## File Size Targets After Refactoring

| File | Before | After (target) |
|------|--------|----------------|
| persist.ts | 1378 | ~300 |
| bulk-sql.ts | — | ~130 |
| sync-entities.ts | — | ~300 |
| sync-publish.ts | — | ~400 |
| dashboard-enrichment.ts | 731 | ~60 (re-exports) |
| development-summary.ts | — | ~350 |
| raw-payload-helpers.ts | — | ~280 |
| build-timeline.ts | 710 | ~400 |
| timeline-range.ts | — | ~250 |

---

## Rollback Strategy

Each step is a pure file split — no logic changes. To rollback a step:
1. Move functions back from extracted file into the original
2. Restore imports
3. Delete the extracted file
4. `npx vitest run && npx tsc --noEmit`

No data migrations, no schema changes, no dependency changes.
