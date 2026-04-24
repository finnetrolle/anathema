# Code Quality Audit — 2026-04-24

Audited files: derive.ts, persist.ts, client.ts, build-timeline.ts, load-dashboard.ts, types.ts, timeline-board.tsx, page.tsx, globals.css.

13 findings total. No unused imports or unused function parameters found.

---

## Dead branches / redundant checks

1. **derive.ts:30** — `ASSIGNEE_COLORS[hash % ASSIGNEE_COLORS.length] ?? FALLBACK_ASSIGNEE_COLOR`. Modulo on a non-empty array always yields a valid index. The `??` branch is unreachable. Remove `?? FALLBACK_ASSIGNEE_COLOR`.

2. **client.ts:112-118** — Second `if` in `buildBaseUrlCandidates` adds `${parsed.origin}/jira`, but the first `if` (line 113) already adds it when `pathname !== "/jira"`. The Set deduplicates, so lines 116-118 are dead code. Delete them.

3. **client.ts:452** — `if (!character) { continue; }` inside a `for...of` loop over a string. String iteration always yields single-character strings; the check never triggers. Remove it.

## Duplicated code

4. **persist.ts:515-569** — `stagedIssue.upsert` has identical `update` and `create` blocks (~50 lines each). Extract a shared `data` object.

5. **build-timeline.ts:466-512 vs 524-570** — `buildRowItem` has two near-identical return blocks differing only in `startColumn` and `span`. Extract the common ~20 fields into a helper.

6. **derive.ts:117-119 vs 141-144** — `deriveStartedAt` and `deriveDoneAt` both contain the same `sortedHistories` sort logic. Extract to a shared helper.

7. **load-dashboard.ts:598-650 vs 652-731** — `readSummaryNode` and `readTargetsSummary` both build a `DerivedDevelopmentSummary` with the same field set and the same `hasDevelopmentSummary` guard. Extract shared accumulation logic.

## Redundant computation

8. **load-dashboard.ts:1075+1085** — `deriveComponentName` is called twice per issue: once for the epic-component map, once for the issue itself. Cache the first result.

9. **load-dashboard.ts:1091+1116** — `deriveAssigneeHistory` is called twice per issue: explicitly on line 1091, and again inside `deriveObservedPeople` on line 1116. Call once and pass the result.

10. **load-dashboard.ts:1035** — `deriveObservedPeople` calls `readRawPayload` again even though `deriveAssigneeHistory` (invoked inside) already parses the same payload. Pass the parsed payload in.

## Naming / hygiene

11. **globals.css:1274-1279** — `.daily-brief-empty` references the deleted `daily-brief` module but is still used in `timeline-board.tsx:312`. Rename to something like `.empty-note` or `.risk-reason-empty`.

12. **load-dashboard.ts:222-226** — `EMPTY_DEVELOPMENT_SUMMARY` is a mutable plain object reused as a starting value in `deriveDevelopmentSummary`. If anyone mutates it in future, all callers break. Freeze it with `Object.freeze()`.

13. **persist.ts:664-678** — `cleanupStagedSyncRun` deletes `stagedJiraProject` and `stagedAssignee` but not `stagedEpic`, `stagedIssue`, or `stagedIssueStatusHistory`. Verify these are cascade-deleted by Prisma; if not, staged rows will leak after publish.
