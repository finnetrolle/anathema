import { DEFAULT_APP_LOCALE, type AppLocale } from "@/modules/i18n/config";
import { prisma } from "@/modules/db/prisma";
import {
  deriveTimelineFields,
  isDoneStatus,
  isInProgressStatus,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";
import { resolveWorkflowRules } from "@/modules/jira/workflow-rules";
import {
  buildTimelineModel,
  getDefaultTimelineRange,
  normalizeDayWidth,
  resolveTimelineRange,
} from "@/modules/timeline/build-timeline";
import {
  buildIssueDateBounds,
  buildIssueScopeWhere,
  buildVisibleIssueWhere,
  resolveScopedConnectionIds,
  resolveTimelineTimezones,
} from "@/modules/timeline/load-dashboard-helpers";
import {
  normalizeTimelineTimezone,
  normalizeTimelineTimezones,
} from "@/modules/timeline/date-helpers";
import {
  buildIssueUrl,
  deriveAssigneeHistory,
  deriveAuthorName,
  deriveComponentName,
  deriveDevelopmentSummary,
  deriveEstimateHours,
  deriveEstimateStoryPoints,
  deriveObservedPeople,
  deriveStatusCategoryKey,
  getTimelinePlaceholderCopy,
  parseDerivedDate,
  readRawPayload,
} from "@/modules/timeline/dashboard-enrichment";
import {
  EMPTY_TIMELINE_ISSUE_RISK,
  type DerivedPersistedTimelineIssue,
  type PersistedTimelineIssue,
  type TimelineIssueRiskSummary,
  type TrackedProject,
  loadCurrentIssueRiskMap,
  timelineIssueSelect,
  timelineScopeProjectSelect,
  trackedProjectSelect,
} from "@/modules/timeline/dashboard-queries";
import type { TimelineEpic } from "@/modules/timeline/types";

type TimelineDashboard = {
  timeline: ReturnType<typeof buildTimelineModel> | null;
  latestSync:
    | {
        status: string;
        issuesFetched: number;
        requestedJql: string;
      }
    | null;
  errorMessage: string | null;
  hasAnyIssues: boolean;
  projectFilter: {
    options: Array<{
      id: string;
      label: string;
    }>;
    selectedProjectId: string | null;
  };
  rangeInputs: {
    from: string;
    to: string;
    dayWidth: string;
  };
};

function buildIssueForTimelineDerivation(
  issue: PersistedTimelineIssue,
): JiraIssue | null {
  const payload = readRawPayload(issue.rawPayload);

  if (!payload?.fields) {
    return null;
  }

  const histories: NonNullable<JiraIssue["changelog"]>["histories"] = [];

  for (const [historyIndex, history] of (payload.changelog?.histories ?? []).entries()) {
    if (typeof history.created !== "string") {
      continue;
    }

    const items =
      history.items
        ?.filter(
          (
            item,
          ): item is {
            field: string;
            fromString?: string | null;
            toString?: string | null;
          } => typeof item.field === "string",
        )
        .map((item) => ({
          field: item.field,
          fromString: item.fromString ?? null,
          toString: item.toString ?? null,
        })) ?? [];

    histories.push({
      id: history.id ?? `${issue.key}:history:${historyIndex}`,
      created: history.created,
      items,
    });
  }

  return {
    id: issue.key,
    key: issue.key,
    fields: payload.fields as JiraIssue["fields"],
    changelog: {
      histories,
    },
  };
}

function deriveIssueTimelineState(
  issue: PersistedTimelineIssue,
  workflowRules: ReturnType<typeof resolveWorkflowRules>,
): DerivedPersistedTimelineIssue["derivedTimeline"] {
  const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
  const issueForDerivation = buildIssueForTimelineDerivation(issue);
  const derivedTimelineFields = issueForDerivation
    ? deriveTimelineFields(issueForDerivation, workflowRules)
    : null;
  const markerKind = derivedTimelineFields?.markerKind ?? issue.markerKind;

  return {
    startAt: derivedTimelineFields
      ? parseDerivedDate(derivedTimelineFields.startAt)
      : issue.startedAt,
    markerAt: derivedTimelineFields
      ? parseDerivedDate(derivedTimelineFields.markerAt)
      : issue.markerAt,
    markerKind,
    isCompleted: isDoneStatus(issue.status, workflowRules, statusCategoryKey),
    isMissingDueDate:
      markerKind === "NONE" &&
      isInProgressStatus(issue.status, workflowRules, statusCategoryKey),
  };
}

function toTimelineEpics(
  issues: DerivedPersistedTimelineIssue[],
  locale: AppLocale = DEFAULT_APP_LOCALE,
  riskByIssueId = new Map<string, TimelineIssueRiskSummary>(),
): TimelineEpic[] {
  const copy = getTimelinePlaceholderCopy(locale);

  const epicComponentMap = new Map<string, string>();
  for (const issue of issues) {
    if (!issue.epic?.id) continue;
    const name = deriveComponentName(issue.rawPayload, locale);
    if (name !== copy.noComponent && !epicComponentMap.has(issue.epic.id)) {
      epicComponentMap.set(issue.epic.id, name);
    }
  }

  const groupedEpics = new Map<string, TimelineEpic>();

  for (const issue of issues) {
    const issueRisk = riskByIssueId.get(issue.id) ?? EMPTY_TIMELINE_ISSUE_RISK;
    let componentName = deriveComponentName(issue.rawPayload, locale);
    if (componentName === copy.noComponent && issue.epic?.id) {
      componentName = epicComponentMap.get(issue.epic.id) ?? componentName;
    }
    const assigneeName = issue.assignee?.displayName ?? copy.unassigned;
    const authorName = deriveAuthorName(issue.rawPayload);
    const assigneeHistory = deriveAssigneeHistory(issue.rawPayload, assigneeName, locale);
    const developmentSummary = deriveDevelopmentSummary(issue.rawPayload);
    const epicId = issue.epic?.id ?? "ungrouped";
    const groupKey = `${componentName}::${epicId}`;
    const existingEpic = groupedEpics.get(groupKey);
    const timelineIssue = {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      issueUrl: buildIssueUrl(issue.project.connection.baseUrl, issue.key),
      timezone: normalizeTimelineTimezone(issue.project.connection.timezone),
      componentName,
      epicId,
      epicKey: issue.epic?.key ?? "NO-EPIC",
      epicSummary: issue.epic?.summary ?? copy.ungroupedWork,
      assigneeName,
      assigneeColor: issue.assignee?.color ?? "#8ec5ff",
      status: issue.status,
      isCompleted: issue.derivedTimeline.isCompleted,
      createdAt: issue.jiraCreatedAt?.toISOString() ?? null,
      startAt: issue.derivedTimeline.startAt?.toISOString() ?? null,
      dueAt: issue.dueAt?.toISOString() ?? null,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      estimateHours: deriveEstimateHours(issue.rawPayload),
      estimateStoryPoints: deriveEstimateStoryPoints(issue.rawPayload),
      observedPeople: deriveObservedPeople(issue.rawPayload, assigneeName, locale),
      assigneeHistory,
      authorName,
      markerAt: issue.derivedTimeline.markerAt?.toISOString() ?? null,
      markerKind: issue.derivedTimeline.markerKind,
      pullRequestStatus: developmentSummary.pullRequestStatus,
      pullRequestCount: developmentSummary.pullRequestCount,
      commitCount: developmentSummary.commitCount,
      isMissingDueDate: issue.derivedTimeline.isMissingDueDate,
      riskScore: issueRisk.riskScore,
      riskLevel: issueRisk.riskLevel,
      riskReasons: issueRisk.riskReasons,
    } satisfies TimelineEpic["issues"][number];

    if (existingEpic) {
      existingEpic.issues.push(timelineIssue);
      continue;
    }

    groupedEpics.set(groupKey, {
      id: groupKey,
      componentName,
      key: issue.epic?.key ?? "NO-EPIC",
      summary: issue.epic?.summary ?? copy.ungroupedWork,
      issues: [timelineIssue],
    });
  }

  return [...groupedEpics.values()].sort((left, right) => {
    const componentCompare = left.componentName.localeCompare(right.componentName);

    if (componentCompare !== 0) {
      return componentCompare;
    }

    return left.key.localeCompare(right.key);
  });
}

type LoadTimelineDashboardInput = {
  from?: string;
  to?: string;
  dayWidth?: string;
  project?: string;
  locale?: AppLocale;
};

function normalizeDateInput(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function buildFallbackRangeInputs(
  from?: string,
  to?: string,
  dayWidth?: string,
  timezones?: string[] | null,
) {
  const normalizedFrom = normalizeDateInput(from);
  const normalizedTo = normalizeDateInput(to);
  const normalizedTimezones = normalizeTimelineTimezones(timezones ?? []);

  if (!normalizedFrom && !normalizedTo) {
    const defaultRange = getDefaultTimelineRange(new Date(), normalizedTimezones);

    return {
      from: defaultRange.startDayKey,
      to: defaultRange.endDayKey,
      dayWidth: String(normalizeDayWidth(dayWidth)),
    };
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    dayWidth: String(normalizeDayWidth(dayWidth)),
  };
}

function formatProjectLabel(project: TrackedProject) {
  const connectionName = project.connection.name.trim();
  const projectName = project.name.trim();

  if (!connectionName) {
    return `${project.key} · ${projectName}`;
  }

  return `${project.key} · ${projectName} (${connectionName})`;
}

export async function loadTimelineDashboard({
  from,
  to,
  dayWidth,
  project,
  locale = DEFAULT_APP_LOCALE,
}: LoadTimelineDashboardInput = {}): Promise<TimelineDashboard> {
  try {
    const trackedProjects = await prisma.jiraProject.findMany({
      select: trackedProjectSelect,
    });
    const projectFilterOptions = trackedProjects
      .map((trackedProject) => ({
        id: trackedProject.id,
        label: formatProjectLabel(trackedProject),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "ru"));
    const selectedProjectId = projectFilterOptions.some(
      (option) => option.id === project,
    )
      ? project ?? null
      : null;
    const issueScopeWhere = buildIssueScopeWhere(selectedProjectId);
    const [issueSummary, scopedProjects] = await Promise.all([
      prisma.issue.aggregate({
        where: issueScopeWhere,
        _count: {
          id: true,
        },
        _min: {
          startedAt: true,
          dueAt: true,
          markerAt: true,
        },
        _max: {
          startedAt: true,
          dueAt: true,
          markerAt: true,
        },
      }),
      prisma.jiraProject.findMany({
        where: selectedProjectId
          ? {
              id: selectedProjectId,
            }
          : undefined,
        select: timelineScopeProjectSelect,
      }),
    ]);
    const timelineTimezones = resolveTimelineTimezones(scopedProjects);
    const scopedConnectionIds = resolveScopedConnectionIds(scopedProjects);
    const totalIssueCount = issueSummary._count.id;
    const resolvedRange = resolveTimelineRange(
      {
        timezones: timelineTimezones,
        rangeStart: from,
        rangeEnd: to,
        dayWidth,
      },
      buildIssueDateBounds(issueSummary),
    );
    const [latestSync, persistedVisibleIssues] = await Promise.all([
      scopedConnectionIds.length > 0
        ? prisma.syncRun.findFirst({
            where: {
              status: "SUCCEEDED",
              jiraConnectionId: {
                in: scopedConnectionIds,
              },
            },
            select: {
              status: true,
              issuesFetched: true,
              requestedJql: true,
            },
            orderBy: {
              startedAt: "desc",
            },
          })
        : null,
      totalIssueCount > 0
        ? prisma.issue.findMany({
            where: buildVisibleIssueWhere(
              issueScopeWhere,
              resolvedRange.visibleStart,
              resolvedRange.visibleEnd,
            ),
            select: timelineIssueSelect,
            orderBy: [
              {
                startedAt: "asc",
              },
              {
                markerAt: "asc",
              },
            ],
          })
        : [],
    ]);
    const workflowRulesByConnection = new Map<
      string,
      ReturnType<typeof resolveWorkflowRules>
    >();
    const visibleIssues = persistedVisibleIssues.map((issue) => {
      let workflowRules = workflowRulesByConnection.get(issue.project.connection.id);

      if (!workflowRules) {
        workflowRules = resolveWorkflowRules(issue.project.connection.workflowRules, {
          connectionId: issue.project.connection.id,
          connectionName: issue.project.connection.name,
        });
        workflowRulesByConnection.set(issue.project.connection.id, workflowRules);
      }

      return {
        ...issue,
        derivedTimeline: deriveIssueTimelineState(issue, workflowRules),
      } satisfies DerivedPersistedTimelineIssue;
    });
    const riskByIssueId = await loadCurrentIssueRiskMap({
      issueIds: visibleIssues.map((issue) => issue.id),
      connectionIds: scopedConnectionIds,
      locale,
    });
    const timeline =
      totalIssueCount > 0
        ? buildTimelineModel(toTimelineEpics(visibleIssues, locale, riskByIssueId), {
            locale,
            resolvedRange,
          })
        : null;

    return {
      timeline,
      latestSync: latestSync
        ? {
            status: latestSync.status,
            issuesFetched: latestSync.issuesFetched,
          requestedJql:
            latestSync.requestedJql ??
            (locale === "ru" ? "JQL по умолчанию" : "default JQL"),
        }
      : null,
      errorMessage: null,
      hasAnyIssues: totalIssueCount > 0,
      projectFilter: {
        options: projectFilterOptions,
        selectedProjectId,
      },
      rangeInputs: timeline
        ? {
            from: timeline.rangeStartInput,
            to: timeline.rangeEndInput,
            dayWidth: String(timeline.dayWidth),
          }
        : buildFallbackRangeInputs(from, to, dayWidth, timelineTimezones),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : locale === "ru"
          ? "Не удалось загрузить таймлайн из Prisma."
          : "Unable to load timeline from Prisma.";

    return {
      timeline: null,
      latestSync: null,
      errorMessage: message,
      hasAnyIssues: false,
      projectFilter: {
        options: [],
        selectedProjectId: null,
      },
      rangeInputs: buildFallbackRangeInputs(from, to, dayWidth),
    };
  }
}
