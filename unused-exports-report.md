# Unused Exports Report

All exports from the specified modules were traced. An export is marked "unused" only when its symbol name does not appear in any import statement (including `import type`) in any other `.ts`/`.tsx` file outside its declaring module. API route `GET`/`POST` exports and types used transitively through re-exports are excluded.

## Legend

- "YES" = used in at least one other file
- "NO" = appears only in its declaring file

---

## src/modules/jira/types.ts

| Export | Used? | Where |
|---|---|---|
| `JiraUser` | NO | -- |
| `JiraAssignee` | NO | -- |
| `JiraIssueFields` | NO | -- |
| `JiraChangelogItem` | NO | -- |
| `JiraChangelogHistory` | NO | -- |
| `JiraIssue` | YES | derive.ts, persist.ts, load-dashboard.ts |
| `JiraSearchResponse` | YES | client.ts |
| `JiraFieldDefinition` | YES | client.ts |

## src/modules/jira/derive.ts

| Export | Used? | Where |
|---|---|---|
| `deriveAssigneeIdentity` | YES | persist.ts |
| `deriveAssigneeColor` | YES | persist.ts, build-timeline.ts |
| `isInProgressStatus` | YES | load-dashboard.ts |
| `isDoneStatus` | YES | load-dashboard.ts |
| `deriveStartedAt` | NO | -- |
| `deriveMarker` | NO | -- |
| `deriveTimelineFields` | YES | persist.ts, load-dashboard.ts |

## src/modules/jira/abort.ts

| Export | Used? | Where |
|---|---|---|
| `JIRA_SYNC_ABORT_MESSAGE` | NO | -- |
| `throwIfAborted` | YES | client.ts, persist.ts |
| `isAbortError` | YES | client.ts, persist.ts |

## src/modules/jira/workflow-rules.ts

| Export | Used? | Where |
|---|---|---|
| `JiraWorkflowRules` (type) | YES | derive.ts, persist.ts |
| `normalizeWorkflowStatusName` | YES | derive.ts |
| `normalizeStatusCategoryKey` | YES | derive.ts |
| `getDefaultWorkflowRules` | YES | derive.ts |
| `resolveWorkflowRules` | YES | persist.ts, load-dashboard.ts |

## src/modules/jira/persist.ts

| Export | Used? | Where |
|---|---|---|
| `runJiraSyncChunk` | YES | API route `api/jira/sync` |
| `runJiraSync` | NO | -- |

## src/modules/jira/client.ts

| Export | Used? | Where |
|---|---|---|
| `JiraRuntimeConfig` (type) | NO | -- |
| `readJiraCredentials` | NO | -- |
| `resolveJiraRuntimeConfig` | YES | persist.ts |
| `searchJiraIssuesPage` | YES | persist.ts |

## src/modules/timeline/types.ts

| Export | Used? | Where |
|---|---|---|
| `TimelineMarkerKind` | YES | task-bounds.ts, build-timeline.ts, load-dashboard.ts |
| `TimelinePullRequestStatus` | YES | build-timeline.ts, load-dashboard.ts |
| `TimelineIssue` | YES | build-timeline.ts |
| `TimelineEpic` | YES | build-timeline.ts, load-dashboard.ts |
| `TimelineColumn` | YES | build-timeline.ts |
| `TimelineLegendItem` | YES | build-timeline.ts |
| `TimelineRowItem` | YES | build-timeline.ts |
| `TimelineRow` | YES | build-timeline.ts |
| `TimelineModel` | YES | build-timeline.ts |

## src/modules/timeline/date-helpers.ts

| Export | Used? | Where |
|---|---|---|
| `DEFAULT_TIMELINE_TIMEZONE` | NO | -- |
| `normalizeTimelineTimezone` | YES | task-bounds.ts, load-dashboard.ts |
| `normalizeTimelineTimezones` | YES | load-dashboard-helpers.ts, load-dashboard.ts, build-timeline.ts |
| `isValidDayKey` | YES | build-timeline.ts |
| `formatTimelineDate` | YES | build-timeline.ts |
| `getDayKey` | YES | task-bounds.ts, build-timeline.ts |
| `getTodayDayKey` | YES | task-bounds.ts, build-timeline.ts |
| `getEndOfDay` | YES | build-timeline.ts |
| `getStartOfWeek` | YES | build-timeline.ts |
| `parseDateInputInTimezone` | YES | build-timeline.ts |
| `parseDateOnlyAtHourInTimezone` | YES | task-bounds.ts |
| `compareDayKeys` | YES | build-timeline.ts |
| `formatTimelineDayKey` | YES | build-timeline.ts |
| `formatTimelineWeekdayFromDayKey` | YES | build-timeline.ts |
| `addDaysToDayKey` | YES | task-bounds.ts, build-timeline.ts |
| `isWeekendDayKey` | YES | task-bounds.ts, build-timeline.ts |
| `isWeekStartDayKey` | YES | build-timeline.ts |
| `getDayKeyDistance` | YES | build-timeline.ts |
| `getEarlierDayKey` | YES | build-timeline.ts |
| `getLaterDayKey` | YES | build-timeline.ts |

## src/modules/timeline/task-bounds.ts

| Export | Used? | Where |
|---|---|---|
| `WORK_HOURS_PER_DAY` | NO | -- |
| `TimelineTaskBoundsInput` (type) | NO | -- |
| `TimelineTaskBounds` (type) | NO | -- |
| `estimateHoursToTimelineDays` | NO | -- |
| `addWorkdaysToDayKey` | NO | -- |
| `resolveTimelineTaskBounds` | YES | build-timeline.ts |

## src/modules/timeline/risk-helpers.ts

| Export | Used? | Where |
|---|---|---|
| `RISK_LEVELS` | NO | -- |
| `RiskLevel` (type) | YES | types.ts, load-dashboard.ts |
| `RISK_REASON_CODES` | NO | -- |
| `RiskReasonCode` (type) | YES | load-dashboard.ts |
| `RiskReasonView` (type) | YES | types.ts, load-dashboard.ts |
| `describeRiskReason` | YES | load-dashboard.ts |
| `getRiskLevelLabel` | NO | -- |

## src/modules/timeline/load-dashboard-helpers.ts

| Export | Used? | Where |
|---|---|---|
| `resolveTimelineTimezones` | YES | load-dashboard.ts |
| `resolveScopedConnectionIds` | YES | load-dashboard.ts |
| `buildIssueScopeWhere` | YES | load-dashboard.ts |
| `buildIssueDateBounds` | YES | load-dashboard.ts |
| `buildVisibleIssueWhere` | YES | load-dashboard.ts |

## src/modules/timeline/build-timeline.ts

| Export | Used? | Where |
|---|---|---|
| `TimelineDateBounds` (type) | YES | load-dashboard-helpers.ts |
| `TimelineResolvedRange` (type) | NO | -- |
| `getDefaultTimelineRange` | YES | load-dashboard.ts |
| `normalizeDayWidth` | YES | load-dashboard.ts |
| `resolveTimelineRange` | YES | load-dashboard.ts |
| `buildTimelineModel` | YES | load-dashboard.ts |

## src/modules/timeline/load-dashboard.ts

| Export | Used? | Where |
|---|---|---|
| `loadTimelineDashboard` | YES | page.tsx (timeline page) |

## src/modules/issues/load-issues.ts

| Export | Used? | Where |
|---|---|---|
| `IssueRow` (type) | NO | -- |
| `IssuesPage` (type) | NO | -- |
| `loadIssuesPage` | YES | API route or page (issues module) |

## src/modules/http/read-json-response.ts

| Export | Used? | Where |
|---|---|---|
| `readJsonResponse` | YES | client.ts |

## src/modules/i18n/config.ts

| Export | Used? | Where |
|---|---|---|
| `APP_LOCALES` | NO | -- |
| `AppLocale` (type) | YES | date-helpers.ts, risk-helpers.ts, presenter.ts, build-timeline.ts, etc. |
| `DEFAULT_APP_LOCALE` | YES | date-helpers.ts, risk-helpers.ts, presenter.ts, build-timeline.ts, load-dashboard.ts |
| `APP_LOCALE_COOKIE` | YES | server.ts |
| `isAppLocale` | NO | -- |
| `normalizeAppLocale` | YES | server.ts |
| `getIntlLocale` | YES | date-helpers.ts, presenter.ts |

## src/modules/i18n/presenter.ts

| Export | Used? | Where |
|---|---|---|
| `getNotAvailableLabel` | NO | -- |
| `formatOptionalDate` | NO | -- |

## src/modules/i18n/server.ts

| Export | Used? | Where |
|---|---|---|
| `getAppLocale` | YES | page/route files |

---

## Summary: UNUSED exports

| # | File | Export | Kind |
|---|---|---|---|
| 1 | jira/types.ts | `JiraUser` | type |
| 2 | jira/types.ts | `JiraAssignee` | type |
| 3 | jira/types.ts | `JiraIssueFields` | type |
| 4 | jira/types.ts | `JiraChangelogItem` | type |
| 5 | jira/types.ts | `JiraChangelogHistory` | type |
| 6 | jira/derive.ts | `deriveStartedAt` | function |
| 7 | jira/derive.ts | `deriveMarker` | function |
| 8 | jira/abort.ts | `JIRA_SYNC_ABORT_MESSAGE` | const |
| 9 | jira/persist.ts | `runJiraSync` | function |
| 10 | jira/client.ts | `JiraRuntimeConfig` | type |
| 11 | jira/client.ts | `readJiraCredentials` | function |
| 12 | timeline/date-helpers.ts | `DEFAULT_TIMELINE_TIMEZONE` | const |
| 13 | timeline/task-bounds.ts | `WORK_HOURS_PER_DAY` | const |
| 14 | timeline/task-bounds.ts | `TimelineTaskBoundsInput` | type |
| 15 | timeline/task-bounds.ts | `TimelineTaskBounds` | type |
| 16 | timeline/task-bounds.ts | `estimateHoursToTimelineDays` | function |
| 17 | timeline/task-bounds.ts | `addWorkdaysToDayKey` | function |
| 18 | timeline/risk-helpers.ts | `RISK_LEVELS` | const |
| 19 | timeline/risk-helpers.ts | `RISK_REASON_CODES` | const |
| 20 | timeline/risk-helpers.ts | `getRiskLevelLabel` | function |
| 21 | timeline/build-timeline.ts | `TimelineResolvedRange` | type |
| 22 | issues/load-issues.ts | `IssueRow` | type |
| 23 | issues/load-issues.ts | `IssuesPage` | type |
| 24 | i18n/config.ts | `APP_LOCALES` | const |
| 25 | i18n/config.ts | `isAppLocale` | function |
| 26 | i18n/presenter.ts | `getNotAvailableLabel` | function |
| 27 | i18n/presenter.ts | `formatOptionalDate` | function |
