import {
  Prisma,
  RiskEntityType as PrismaRiskEntityType,
  RiskLevel as PrismaRiskLevel,
  RiskReasonCode as PrismaRiskReasonCode,
  SyncStatus,
} from "@prisma/client";

import {
  DEFAULT_APP_LOCALE,
  type AppLocale,
} from "@/modules/i18n/config";
import { prisma } from "@/modules/db/prisma";
import {
  buildIssueUrl,
  deriveComponentName,
  deriveDevelopmentSummary,
  deriveEstimateHours,
  deriveEstimateStoryPoints,
  deriveStatusCategoryKey,
  sortChangelogHistories,
} from "@/modules/daily-brief/issue-signals";
import { isDoneStatus, isInProgressStatus } from "@/modules/jira/derive";
import { resolveWorkflowRules } from "@/modules/jira/workflow-rules";
import { getStartOfDay } from "@/modules/timeline/date-helpers";

import { describeRiskReason } from "./reasons";
import type {
  DerivedRiskReason,
  RiskEntityDetail,
  RiskEntityType,
  RiskEntityView,
  RiskLevel,
  RiskOverview,
  RiskRadarDashboard,
  RiskReasonBreakdownItem,
  RiskReasonCode,
  RiskThresholds,
} from "./types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS: RiskThresholds = {
  agingDaysWarning: 5,
  agingDaysCritical: 10,
  reassignmentsThreshold: 2,
  staleDevActivityDays: 3,
  epicHighRiskIssueCount: 2,
};
const UNASSIGNED_ENTITY_KEY = "__unassigned__";

const riskSourceIssueSelect = {
  id: true,
  jiraIssueId: true,
  key: true,
  summary: true,
  status: true,
  issueType: true,
  dueAt: true,
  resolvedAt: true,
  startedAt: true,
  markerAt: true,
  markerKind: true,
  jiraUpdatedAt: true,
  rawPayload: true,
  assignee: {
    select: {
      jiraAccountId: true,
      displayName: true,
    },
  },
  epic: {
    select: {
      id: true,
      key: true,
      summary: true,
    },
  },
  project: {
    select: {
      id: true,
      key: true,
      name: true,
      connection: {
        select: {
          id: true,
          name: true,
          baseUrl: true,
          timezone: true,
          workflowRules: true,
        },
      },
    },
  },
} satisfies Prisma.IssueSelect;

type RiskSourceIssue = Prisma.IssueGetPayload<{
  select: typeof riskSourceIssueSelect;
}>;

const projectFilterSelect = {
  id: true,
  key: true,
  name: true,
  connection: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.JiraProjectSelect;

const riskSnapshotSelect = {
  id: true,
  jiraConnectionId: true,
  jiraProjectId: true,
  epicId: true,
  issueId: true,
  entityType: true,
  entityKey: true,
  riskScore: true,
  riskLevel: true,
  computedAt: true,
  snapshotDate: true,
  reasons: {
    orderBy: {
      weight: "desc",
    },
    select: {
      reasonCode: true,
      weight: true,
      detailsJson: true,
    },
  },
  connection: {
    select: {
      id: true,
      name: true,
    },
  },
  project: {
    select: {
      id: true,
      key: true,
      name: true,
      connection: {
        select: {
          baseUrl: true,
        },
      },
    },
  },
  epic: {
    select: {
      id: true,
      key: true,
      summary: true,
    },
  },
  issue: {
    select: {
      id: true,
      key: true,
      summary: true,
    },
  },
} satisfies Prisma.RiskSnapshotSelect;

type PersistedRiskSnapshot = Prisma.RiskSnapshotGetPayload<{
  select: typeof riskSnapshotSelect;
}>;

type RiskStatusTransition = {
  changedAt: Date;
  fromStatus: string | null;
  toStatus: string;
};

type RiskAssigneeTransition = {
  changedAt: Date;
  fromAssigneeName: string | null;
  toAssigneeName: string | null;
};

export type RiskSourceIssueSnapshot = {
  connectionId: string;
  connectionName: string;
  connectionBaseUrl: string | null;
  connectionTimezone: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  issueId: string;
  issueJiraId: string;
  issueKey: string;
  issueSummary: string;
  issueUrl: string | null;
  status: string;
  isCompleted: boolean;
  isInProgress: boolean;
  startAt: Date | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  jiraUpdatedAt: Date | null;
  epicId: string | null;
  epicKey: string | null;
  epicSummary: string | null;
  assigneeEntityKey: string;
  assigneeAccountId: string | null;
  assigneeName: string;
  componentName: string;
  componentNames: string[];
  estimateHours: number | null;
  estimateStoryPoints: number | null;
  pullRequestCount: number;
  commitCount: number;
  statusTransitions: RiskStatusTransition[];
  assigneeTransitions: RiskAssigneeTransition[];
  reopenedCount: number;
  latestReopenedAt: Date | null;
};

type DerivedIssueRiskSnapshot = RiskSourceIssueSnapshot & {
  entityType: "ISSUE";
  entityKey: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: DerivedRiskReason[];
  linkedIssueKeys: string[];
};

type DerivedAggregateSnapshot = {
  jiraConnectionId: string;
  jiraProjectId: string | null;
  epicId: string | null;
  issueId: string | null;
  entityType: Exclude<RiskEntityType, "ISSUE">;
  entityKey: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: DerivedRiskReason[];
  linkedIssueKeys: string[];
};

type PersistableSnapshot = {
  jiraConnectionId: string;
  jiraProjectId: string | null;
  epicId: string | null;
  issueId: string | null;
  entityType: RiskEntityType;
  entityKey: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: DerivedRiskReason[];
};

type AssigneeFilterValue = {
  connectionId: string;
  entityKey: string;
} | null;

type LoadStateInput = {
  project?: string;
  component?: string;
  assignee?: string;
  entityId?: string;
  locale?: AppLocale;
};

type LoadStateResult = {
  allViews: RiskEntityView[];
  issueViews: RiskEntityView[];
  epicViews: RiskEntityView[];
  projectViews: RiskEntityView[];
  hotspotViews: RiskEntityView[];
  selectedEntity: RiskEntityDetail | null;
  latestRunAt: string | null;
  previousRunAt: string | null;
  latestSync:
    | {
        status: string;
        issuesFetched: number;
        requestedJql: string;
        finishedAt: string | null;
      }
    | null;
  filterOptions: RiskRadarDashboard["filterOptions"];
  filters: RiskRadarDashboard["filters"];
  emptyStateMessage: string | null;
};

type LiveGroupContext = {
  label: string;
  summary: string | null;
  projectId: string | null;
  projectKey: string | null;
  linkedIssueKeys: string[];
};

type LiveEntityContext = {
  issueByKey: Map<string, RiskSourceIssueSnapshot>;
  issueGroups: Map<string, LiveGroupContext>;
  epicGroups: Map<string, LiveGroupContext>;
  projectGroups: Map<string, LiveGroupContext>;
  assigneeGroups: Map<string, LiveGroupContext>;
  componentGroups: Map<string, LiveGroupContext>;
};

function toPrismaJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function clampRiskScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRiskRadarCopy(locale: AppLocale) {
  return {
    unassigned: locale === "ru" ? "Не назначен" : "Unassigned",
    noLinkedScope: locale === "ru" ? "Нет связанного scope" : "No linked scope",
    linkedIssues: locale === "ru" ? "связанных задач" : "linked issues",
    more: locale === "ru" ? "ещё" : "more",
    runSyncFirst:
      locale === "ru"
        ? "Сначала запусти синхронизацию Jira, чтобы заполнить снапшоты Risk Radar."
        : "Run a Jira sync first to populate Risk Radar snapshots.",
    snapshotsUnavailable:
      locale === "ru"
        ? "Снапшоты риска пока недоступны. Запусти sync или recompute, чтобы их сгенерировать."
        : "Risk snapshots are not available yet. Trigger a sync or recompute to generate them.",
    noRisksMatchFilters:
      locale === "ru"
        ? "Текущим фильтрам ничего не соответствует."
        : "No risks match the current filters.",
  };
}

export function deriveRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "CRITICAL";
  }

  if (score >= 50) {
    return "HIGH";
  }

  if (score >= 25) {
    return "MEDIUM";
  }

  return "LOW";
}

function isHighRiskLevel(level: RiskLevel) {
  return level === "HIGH" || level === "CRITICAL";
}

function dayDifference(earlier: Date, later: Date) {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY_IN_MS));
}

function splitComponentNames(value: string) {
  const names = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return names.length > 0 ? names : [value];
}

function readDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractTransitions(rawPayload: Prisma.JsonValue | null) {
  const statusTransitions: RiskStatusTransition[] = [];
  const assigneeTransitions: RiskAssigneeTransition[] = [];

  for (const history of sortChangelogHistories(rawPayload)) {
    const changedAt = readDate(history.created);

    if (!changedAt) {
      continue;
    }

    for (const item of history.items ?? []) {
      const normalizedField = item.field?.trim().toLowerCase();

      if (normalizedField === "status" && item.toString) {
        statusTransitions.push({
          changedAt,
          fromStatus: item.fromString ?? null,
          toStatus: item.toString,
        });
      }

      if (normalizedField === "assignee") {
        assigneeTransitions.push({
          changedAt,
          fromAssigneeName: item.fromString?.trim() || null,
          toAssigneeName: item.toString?.trim() || null,
        });
      }
    }
  }

  return {
    statusTransitions,
    assigneeTransitions,
  };
}

function toScopedGroupKey(connectionId: string, entityKey: string) {
  return `${connectionId}:${entityKey}`;
}

function toScopedSnapshotKey(
  connectionId: string,
  entityType: RiskEntityType,
  entityKey: string,
) {
  return `${connectionId}:${entityType}:${entityKey}`;
}

function toDetailsRecord(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseAssigneeFilter(value?: string | null): AssigneeFilterValue {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    connectionId: value.slice(0, separatorIndex),
    entityKey: value.slice(separatorIndex + 1),
  };
}

function matchesAssigneeFilter(
  issue: RiskSourceIssueSnapshot,
  assigneeFilter: AssigneeFilterValue,
) {
  if (!assigneeFilter) {
    return true;
  }

  return (
    issue.connectionId === assigneeFilter.connectionId &&
    issue.assigneeEntityKey === assigneeFilter.entityKey
  );
}

function matchesComponentFilter(issue: RiskSourceIssueSnapshot, componentFilter: string) {
  if (!componentFilter) {
    return true;
  }

  return issue.componentNames.includes(componentFilter);
}

function matchesProjectFilter(issue: RiskSourceIssueSnapshot, projectId: string) {
  if (!projectId) {
    return true;
  }

  return issue.projectId === projectId;
}

export function deriveIssueRiskSnapshot(
  issue: RiskSourceIssueSnapshot,
  thresholds: RiskThresholds,
  now: Date,
): DerivedIssueRiskSnapshot {
  const reasons: DerivedRiskReason[] = [];

  if (issue.dueAt && !issue.isCompleted && issue.dueAt.getTime() < now.getTime()) {
    reasons.push({
      reasonCode: "OVERDUE",
      weight: 30,
      details: {
        daysOverdue: dayDifference(issue.dueAt, now),
        dueAt: issue.dueAt.toISOString(),
      },
    });
  }

  if (issue.isInProgress && issue.startAt) {
    const ageDays = dayDifference(issue.startAt, now);

    if (ageDays >= thresholds.agingDaysWarning) {
      reasons.push({
        reasonCode: "AGING_WIP",
        weight: ageDays >= thresholds.agingDaysCritical ? 30 : 20,
        details: {
          ageDays,
          severity:
            ageDays >= thresholds.agingDaysCritical ? "critical" : "warning",
          startedAt: issue.startAt.toISOString(),
        },
      });
    }
  }

  if (
    issue.isInProgress &&
    issue.estimateHours === null &&
    issue.estimateStoryPoints === null
  ) {
    reasons.push({
      reasonCode: "MISSING_ESTIMATE",
      weight: 10,
      details: {},
    });
  }

  if (issue.isInProgress && !issue.dueAt) {
    reasons.push({
      reasonCode: "MISSING_DUE_DATE",
      weight: 10,
      details: {},
    });
  }

  const inactivityReferenceAt = issue.startAt ?? issue.jiraUpdatedAt;

  if (
    issue.isInProgress &&
    inactivityReferenceAt &&
    issue.pullRequestCount === 0 &&
    issue.commitCount === 0
  ) {
    const staleDays = dayDifference(inactivityReferenceAt, now);

    if (staleDays >= thresholds.staleDevActivityDays) {
      reasons.push({
        reasonCode: "NO_DEV_ACTIVITY",
        weight: 15,
        details: {
          staleDays,
          referenceAt: inactivityReferenceAt.toISOString(),
        },
      });
    }
  }

  if (
    !issue.isCompleted &&
    issue.assigneeTransitions.length >= thresholds.reassignmentsThreshold
  ) {
    reasons.push({
      reasonCode: "ASSIGNEE_CHURN",
      weight: 15,
      details: {
        reassignmentCount: issue.assigneeTransitions.length,
      },
    });
  }

  if (!issue.isCompleted && issue.reopenedCount > 0) {
    reasons.push({
      reasonCode: "REOPENED",
      weight: 25,
      details: {
        reopenedCount: issue.reopenedCount,
        latestReopenedAt: issue.latestReopenedAt?.toISOString() ?? null,
      },
    });
  }

  const riskScore = clampRiskScore(
    reasons.reduce((sum, reason) => sum + reason.weight, 0),
  );

  return {
    ...issue,
    entityType: "ISSUE",
    entityKey: issue.issueKey,
    riskScore,
    riskLevel: deriveRiskLevel(riskScore),
    reasons,
    linkedIssueKeys: [issue.issueKey],
  };
}

function buildHighRiskChildrenReason(
  entityType: "PROJECT" | "EPIC",
  riskyIssueCount: number,
  linkedIssueKeys: string[],
): DerivedRiskReason | null {
  if (riskyIssueCount <= 0) {
    return null;
  }

  return {
    reasonCode: "HIGH_RISK_CHILDREN",
    weight: entityType === "PROJECT" ? 20 : 15,
    details: {
      entityType,
      riskyIssueCount,
      linkedIssueKeys,
    },
  };
}

function buildSpreadRiskReason(issues: DerivedIssueRiskSnapshot[]): DerivedRiskReason | null {
  const components = [...new Set(issues.flatMap((issue) => issue.componentNames))];

  if (components.length < 2) {
    return null;
  }

  return {
    reasonCode: "SPREAD_RISK",
    weight: 10,
    details: {
      componentCount: components.length,
      components,
    },
  };
}

function buildConcentrationReason(
  riskyIssueCount: number,
  totalIssueCount: number,
  linkedIssueKeys: string[],
): DerivedRiskReason | null {
  if (riskyIssueCount <= 0 || totalIssueCount <= 0) {
    return null;
  }

  return {
    reasonCode: "CONCENTRATION_RISK",
    weight: 15,
    details: {
      riskyIssueCount,
      totalIssueCount,
      sharePercent: Math.round((riskyIssueCount / totalIssueCount) * 100),
      linkedIssueKeys,
    },
  };
}

function aggregateRiskGroup(params: {
  entityType: Exclude<RiskEntityType, "ISSUE">;
  entityKey: string;
  jiraConnectionId: string;
  jiraProjectId?: string | null;
  epicId?: string | null;
  issues: DerivedIssueRiskSnapshot[];
  thresholds: RiskThresholds;
}): DerivedAggregateSnapshot | null {
  const activeIssues = params.issues.filter((issue) => !issue.isCompleted);

  if (activeIssues.length === 0) {
    return null;
  }

  const riskyIssues = activeIssues.filter((issue) => isHighRiskLevel(issue.riskLevel));
  const baseAverage =
    activeIssues.reduce((sum, issue) => sum + issue.riskScore, 0) / activeIssues.length;
  const reasons: DerivedRiskReason[] = [];
  const linkedIssueKeys = [...new Set(activeIssues.map((issue) => issue.issueKey))];

  if (
    (params.entityType === "EPIC" || params.entityType === "PROJECT") &&
    riskyIssues.length >= params.thresholds.epicHighRiskIssueCount
  ) {
    const highRiskChildrenReason = buildHighRiskChildrenReason(
      params.entityType,
      riskyIssues.length,
      linkedIssueKeys,
    );

    if (highRiskChildrenReason) {
      reasons.push(highRiskChildrenReason);
    }
  }

  if (params.entityType === "EPIC" || params.entityType === "PROJECT") {
    const spreadRiskReason = buildSpreadRiskReason(riskyIssues);

    if (spreadRiskReason) {
      reasons.push(spreadRiskReason);
    }
  }

  if (params.entityType === "PROJECT") {
    const assigneeCounts = new Map<string, number>();

    for (const issue of riskyIssues) {
      assigneeCounts.set(
        issue.assigneeEntityKey,
        (assigneeCounts.get(issue.assigneeEntityKey) ?? 0) + 1,
      );
    }

    const highestCount = Math.max(0, ...assigneeCounts.values());

    if (highestCount >= params.thresholds.epicHighRiskIssueCount) {
      const concentrationReason = buildConcentrationReason(
        highestCount,
        activeIssues.length,
        linkedIssueKeys,
      );

      if (concentrationReason) {
        reasons.push(concentrationReason);
      }
    }
  }

  if (params.entityType === "ASSIGNEE" || params.entityType === "COMPONENT") {
    if (
      riskyIssues.length >= params.thresholds.epicHighRiskIssueCount ||
      (activeIssues.length > 0 && riskyIssues.length / activeIssues.length >= 0.5)
    ) {
      const concentrationReason = buildConcentrationReason(
        riskyIssues.length,
        activeIssues.length,
        linkedIssueKeys,
      );

      if (concentrationReason) {
        reasons.push(concentrationReason);
      }
    }
  }

  const riskScore = clampRiskScore(
    baseAverage * 0.8 + reasons.reduce((sum, reason) => sum + reason.weight, 0),
  );

  return {
    jiraConnectionId: params.jiraConnectionId,
    jiraProjectId: params.jiraProjectId ?? null,
    epicId: params.epicId ?? null,
    issueId: null,
    entityType: params.entityType,
    entityKey: params.entityKey,
    riskScore,
    riskLevel: deriveRiskLevel(riskScore),
    reasons,
    linkedIssueKeys,
  };
}

function buildIssueSources(
  issues: RiskSourceIssue[],
  locale: AppLocale,
) {
  const copy = getRiskRadarCopy(locale);
  const workflowRulesByConnection = new Map<
    string,
    ReturnType<typeof resolveWorkflowRules>
  >();

  return issues.map((issue) => {
    let workflowRules = workflowRulesByConnection.get(issue.project.connection.id);

    if (!workflowRules) {
      workflowRules = resolveWorkflowRules(issue.project.connection.workflowRules, {
        connectionId: issue.project.connection.id,
        connectionName: issue.project.connection.name,
      });
      workflowRulesByConnection.set(issue.project.connection.id, workflowRules);
    }

    const statusCategoryKey = deriveStatusCategoryKey(issue.rawPayload);
    const componentName = deriveComponentName(issue.rawPayload);
    const developmentSummary = deriveDevelopmentSummary(issue.rawPayload);
    const { statusTransitions, assigneeTransitions } = extractTransitions(issue.rawPayload);
    const reopenedTransitions = statusTransitions.filter(
      (transition) =>
        isDoneStatus(transition.fromStatus, workflowRules) &&
        !isDoneStatus(transition.toStatus, workflowRules),
    );
    const assigneeName = issue.assignee?.displayName ?? copy.unassigned;

    return {
      connectionId: issue.project.connection.id,
      connectionName: issue.project.connection.name,
      connectionBaseUrl: issue.project.connection.baseUrl ?? null,
      connectionTimezone: issue.project.connection.timezone,
      projectId: issue.project.id,
      projectKey: issue.project.key,
      projectName: issue.project.name,
      issueId: issue.id,
      issueJiraId: issue.jiraIssueId,
      issueKey: issue.key,
      issueSummary: issue.summary,
      issueUrl: buildIssueUrl(issue.project.connection.baseUrl, issue.key),
      status: issue.status,
      isCompleted: isDoneStatus(issue.status, workflowRules, statusCategoryKey),
      isInProgress: isInProgressStatus(issue.status, workflowRules, statusCategoryKey),
      startAt: issue.startedAt,
      dueAt: issue.dueAt,
      resolvedAt: issue.resolvedAt,
      jiraUpdatedAt: issue.jiraUpdatedAt,
      epicId: issue.epic?.id ?? null,
      epicKey: issue.epic?.key ?? null,
      epicSummary: issue.epic?.summary ?? null,
      assigneeEntityKey: issue.assignee?.jiraAccountId ?? UNASSIGNED_ENTITY_KEY,
      assigneeAccountId: issue.assignee?.jiraAccountId ?? null,
      assigneeName,
      componentName,
      componentNames: splitComponentNames(componentName),
      estimateHours: deriveEstimateHours(issue.rawPayload),
      estimateStoryPoints: deriveEstimateStoryPoints(issue.rawPayload),
      pullRequestCount: developmentSummary.pullRequestCount,
      commitCount: developmentSummary.commitCount,
      statusTransitions,
      assigneeTransitions,
      reopenedCount: reopenedTransitions.length,
      latestReopenedAt: reopenedTransitions.at(-1)?.changedAt ?? null,
    } satisfies RiskSourceIssueSnapshot;
  });
}

function buildPersistableSnapshots(params: {
  issues: RiskSourceIssueSnapshot[];
  thresholds: RiskThresholds;
  now: Date;
}) {
  const issueSnapshots = params.issues.map((issue) =>
    deriveIssueRiskSnapshot(issue, params.thresholds, params.now),
  );
  const persistable: PersistableSnapshot[] = issueSnapshots.map((issue) => ({
    jiraConnectionId: issue.connectionId,
    jiraProjectId: issue.projectId,
    epicId: issue.epicId,
    issueId: issue.issueId,
    entityType: "ISSUE",
    entityKey: issue.entityKey,
    riskScore: issue.riskScore,
    riskLevel: issue.riskLevel,
    reasons: issue.reasons,
  }));
  const issueGroupsByEpic = new Map<string, DerivedIssueRiskSnapshot[]>();
  const issueGroupsByProject = new Map<string, DerivedIssueRiskSnapshot[]>();
  const issueGroupsByAssignee = new Map<string, DerivedIssueRiskSnapshot[]>();
  const issueGroupsByComponent = new Map<string, DerivedIssueRiskSnapshot[]>();

  for (const issue of issueSnapshots) {
    if (!issue.isCompleted && issue.epicKey && issue.epicId) {
      const epicGroupKey = toScopedGroupKey(issue.connectionId, issue.epicKey);
      const group = issueGroupsByEpic.get(epicGroupKey) ?? [];

      group.push(issue);
      issueGroupsByEpic.set(epicGroupKey, group);
    }

    if (!issue.isCompleted) {
      const projectGroupKey = toScopedGroupKey(issue.connectionId, issue.projectKey);
      const projectGroup = issueGroupsByProject.get(projectGroupKey) ?? [];

      projectGroup.push(issue);
      issueGroupsByProject.set(projectGroupKey, projectGroup);

      const assigneeGroupKey = toScopedGroupKey(
        issue.connectionId,
        issue.assigneeEntityKey,
      );
      const assigneeGroup = issueGroupsByAssignee.get(assigneeGroupKey) ?? [];

      assigneeGroup.push(issue);
      issueGroupsByAssignee.set(assigneeGroupKey, assigneeGroup);

      for (const componentName of issue.componentNames) {
        const componentGroupKey = toScopedGroupKey(issue.connectionId, componentName);
        const componentGroup = issueGroupsByComponent.get(componentGroupKey) ?? [];

        componentGroup.push(issue);
        issueGroupsByComponent.set(componentGroupKey, componentGroup);
      }
    }
  }

  for (const issues of issueGroupsByEpic.values()) {
    const firstIssue = issues[0];

    if (!firstIssue?.epicKey || !firstIssue.epicId) {
      continue;
    }

    const aggregate = aggregateRiskGroup({
      entityType: "EPIC",
      entityKey: firstIssue.epicKey,
      jiraConnectionId: firstIssue.connectionId,
      jiraProjectId: firstIssue.projectId,
      epicId: firstIssue.epicId,
      issues,
      thresholds: params.thresholds,
    });

    if (aggregate) {
      persistable.push({
        jiraConnectionId: aggregate.jiraConnectionId,
        jiraProjectId: aggregate.jiraProjectId,
        epicId: aggregate.epicId,
        issueId: null,
        entityType: aggregate.entityType,
        entityKey: aggregate.entityKey,
        riskScore: aggregate.riskScore,
        riskLevel: aggregate.riskLevel,
        reasons: aggregate.reasons,
      });
    }
  }

  for (const issues of issueGroupsByProject.values()) {
    const firstIssue = issues[0];

    if (!firstIssue) {
      continue;
    }

    const aggregate = aggregateRiskGroup({
      entityType: "PROJECT",
      entityKey: firstIssue.projectKey,
      jiraConnectionId: firstIssue.connectionId,
      jiraProjectId: firstIssue.projectId,
      issues,
      thresholds: params.thresholds,
    });

    if (aggregate) {
      persistable.push({
        jiraConnectionId: aggregate.jiraConnectionId,
        jiraProjectId: aggregate.jiraProjectId,
        epicId: null,
        issueId: null,
        entityType: aggregate.entityType,
        entityKey: aggregate.entityKey,
        riskScore: aggregate.riskScore,
        riskLevel: aggregate.riskLevel,
        reasons: aggregate.reasons,
      });
    }
  }

  for (const issues of issueGroupsByAssignee.values()) {
    const firstIssue = issues[0];

    if (!firstIssue) {
      continue;
    }

    const aggregate = aggregateRiskGroup({
      entityType: "ASSIGNEE",
      entityKey: firstIssue.assigneeEntityKey,
      jiraConnectionId: firstIssue.connectionId,
      jiraProjectId:
        new Set(issues.map((issue) => issue.projectId)).size === 1
          ? firstIssue.projectId
          : null,
      issues,
      thresholds: params.thresholds,
    });

    if (aggregate) {
      persistable.push({
        jiraConnectionId: aggregate.jiraConnectionId,
        jiraProjectId: aggregate.jiraProjectId,
        epicId: null,
        issueId: null,
        entityType: aggregate.entityType,
        entityKey: aggregate.entityKey,
        riskScore: aggregate.riskScore,
        riskLevel: aggregate.riskLevel,
        reasons: aggregate.reasons,
      });
    }
  }

  for (const [groupKey, issues] of issueGroupsByComponent.entries()) {
    const firstIssue = issues[0];

    if (!firstIssue) {
      continue;
    }

    const entityKey = groupKey.slice(firstIssue.connectionId.length + 1);
    const aggregate = aggregateRiskGroup({
      entityType: "COMPONENT",
      entityKey,
      jiraConnectionId: firstIssue.connectionId,
      jiraProjectId:
        new Set(issues.map((issue) => issue.projectId)).size === 1
          ? firstIssue.projectId
          : null,
      issues,
      thresholds: params.thresholds,
    });

    if (aggregate) {
      persistable.push({
        jiraConnectionId: aggregate.jiraConnectionId,
        jiraProjectId: aggregate.jiraProjectId,
        epicId: null,
        issueId: null,
        entityType: aggregate.entityType,
        entityKey: aggregate.entityKey,
        riskScore: aggregate.riskScore,
        riskLevel: aggregate.riskLevel,
        reasons: aggregate.reasons,
      });
    }
  }

  return {
    issueSnapshots,
    persistable,
  };
}

async function ensureThresholdConfig(jiraConnectionId: string) {
  const config = await prisma.riskThresholdConfig.upsert({
    where: {
      jiraConnectionId,
    },
    update: {},
    create: {
      jiraConnectionId,
      ...DEFAULT_THRESHOLDS,
    },
  });

  return {
    agingDaysWarning: config.agingDaysWarning,
    agingDaysCritical: config.agingDaysCritical,
    reassignmentsThreshold: config.reassignmentsThreshold,
    staleDevActivityDays: config.staleDevActivityDays,
    epicHighRiskIssueCount: config.epicHighRiskIssueCount,
  } satisfies RiskThresholds;
}

async function loadRiskSourceIssues(projectId?: string, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const issues = await prisma.issue.findMany({
    where: {
      issueType: {
        not: "Epic",
      },
      ...(projectId
        ? {
            jiraProjectId: projectId,
          }
        : {}),
    },
    select: riskSourceIssueSelect,
  });

  return buildIssueSources(issues, locale);
}

async function loadProjectFilterOptions() {
  const projects = await prisma.jiraProject.findMany({
    select: projectFilterSelect,
  });

  return projects
    .map((project) => ({
      id: project.id,
      label: `${project.key} · ${project.name} (${project.connection.name})`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
}

function registerLiveGroup(
  target: Map<string, LiveGroupContext>,
  key: string,
  value: Omit<LiveGroupContext, "linkedIssueKeys">,
  issueKey: string,
) {
  const existing = target.get(key);

  if (existing) {
    if (!existing.linkedIssueKeys.includes(issueKey)) {
      existing.linkedIssueKeys.push(issueKey);
    }

    return;
  }

  target.set(key, {
    ...value,
    linkedIssueKeys: [issueKey],
  });
}

function buildLiveContext(issues: RiskSourceIssueSnapshot[]): LiveEntityContext {
  const issueByKey = new Map<string, RiskSourceIssueSnapshot>();
  const issueGroups = new Map<string, LiveGroupContext>();
  const epicGroups = new Map<string, LiveGroupContext>();
  const projectGroups = new Map<string, LiveGroupContext>();
  const assigneeGroups = new Map<string, LiveGroupContext>();
  const componentGroups = new Map<string, LiveGroupContext>();

  for (const issue of issues) {
    issueByKey.set(issue.issueKey, issue);
    registerLiveGroup(
      issueGroups,
      toScopedGroupKey(issue.connectionId, issue.issueKey),
      {
        label: issue.issueKey,
        summary: issue.issueSummary,
        projectId: issue.projectId,
        projectKey: issue.projectKey,
      },
      issue.issueKey,
    );

    if (issue.isCompleted) {
      continue;
    }

    registerLiveGroup(
      projectGroups,
      toScopedGroupKey(issue.connectionId, issue.projectKey),
      {
        label: issue.projectKey,
        summary: issue.projectName,
        projectId: issue.projectId,
        projectKey: issue.projectKey,
      },
      issue.issueKey,
    );

    if (issue.epicKey) {
      registerLiveGroup(
        epicGroups,
        toScopedGroupKey(issue.connectionId, issue.epicKey),
        {
          label: issue.epicKey,
          summary: issue.epicSummary,
          projectId: issue.projectId,
          projectKey: issue.projectKey,
        },
        issue.issueKey,
      );
    }

    registerLiveGroup(
      assigneeGroups,
      toScopedGroupKey(issue.connectionId, issue.assigneeEntityKey),
      {
        label: issue.assigneeName,
        summary: null,
        projectId: null,
        projectKey: null,
      },
      issue.issueKey,
    );

    for (const componentName of issue.componentNames) {
      registerLiveGroup(
        componentGroups,
        toScopedGroupKey(issue.connectionId, componentName),
        {
          label: componentName,
          summary: null,
          projectId: null,
          projectKey: null,
        },
        issue.issueKey,
      );
    }
  }

  return {
    issueByKey,
    issueGroups,
    epicGroups,
    projectGroups,
    assigneeGroups,
    componentGroups,
  };
}

function buildAffectedScope(
  linkedIssueKeys: string[],
  issueByKey: Map<string, RiskSourceIssueSnapshot>,
  locale: AppLocale,
) {
  const copy = getRiskRadarCopy(locale);
  const labels = [...new Set(
    linkedIssueKeys
      .map((issueKey) => issueByKey.get(issueKey))
      .filter((issue): issue is RiskSourceIssueSnapshot => Boolean(issue))
      .map((issue) => `${issue.projectKey} · ${issue.projectName}`),
  )];

  if (labels.length === 0) {
    return copy.noLinkedScope;
  }

  if (labels.length === 1) {
    return labels[0] ?? copy.noLinkedScope;
  }

  return `${labels[0]} +${labels.length - 1} ${copy.more}`;
}

function resolveGroupContext(
  snapshot: PersistedRiskSnapshot,
  liveContext: LiveEntityContext,
) {
  const scopedKey = toScopedGroupKey(snapshot.jiraConnectionId, snapshot.entityKey);

  switch (snapshot.entityType as RiskEntityType) {
    case "ISSUE":
      return liveContext.issueGroups.get(scopedKey) ?? null;
    case "EPIC":
      return liveContext.epicGroups.get(scopedKey) ?? null;
    case "PROJECT":
      return liveContext.projectGroups.get(scopedKey) ?? null;
    case "ASSIGNEE":
      return liveContext.assigneeGroups.get(scopedKey) ?? null;
    case "COMPONENT":
      return liveContext.componentGroups.get(scopedKey) ?? null;
  }
}

function buildTimelineHref(projectId: string | null) {
  return projectId ? `/?project=${encodeURIComponent(projectId)}` : "/";
}

function toViewReasons(snapshot: PersistedRiskSnapshot, locale: AppLocale) {
  return snapshot.reasons.map((reason) =>
    describeRiskReason(
      locale,
      reason.reasonCode as RiskReasonCode,
      reason.weight,
      toDetailsRecord(reason.detailsJson),
    ),
  );
}

function toRiskEntityView(params: {
  snapshot: PersistedRiskSnapshot;
  previousSnapshot: PersistedRiskSnapshot | null;
  liveContext: LiveEntityContext;
  locale: AppLocale;
}): RiskEntityView {
  const { snapshot, previousSnapshot, liveContext, locale } = params;
  const copy = getRiskRadarCopy(locale);
  const groupContext = resolveGroupContext(snapshot, liveContext);
  const linkedIssueKeys =
    groupContext?.linkedIssueKeys ??
    (snapshot.issue?.key ? [snapshot.issue.key] : []);
  const projectId =
    groupContext?.projectId ?? snapshot.project?.id ?? snapshot.jiraProjectId ?? null;
  const projectKey = groupContext?.projectKey ?? snapshot.project?.key ?? null;
  const label =
    groupContext?.label ??
    snapshot.issue?.key ??
    snapshot.epic?.key ??
    snapshot.project?.key ??
    snapshot.entityKey;
  const subtitle =
    groupContext?.summary ??
    snapshot.issue?.summary ??
    snapshot.epic?.summary ??
    snapshot.project?.name ??
    `${linkedIssueKeys.length} ${copy.linkedIssues}`;
  const scoreDelta =
    previousSnapshot === null
      ? null
      : snapshot.riskScore - previousSnapshot.riskScore;
  const isNewRisk =
    snapshot.riskLevel !== "LOW" &&
    (previousSnapshot === null || previousSnapshot.riskLevel === "LOW");
  const isPersistentRisk =
    snapshot.riskLevel !== "LOW" &&
    previousSnapshot !== null &&
    previousSnapshot.riskLevel !== "LOW";

  return {
    id: snapshot.id,
    entityType: snapshot.entityType as RiskEntityType,
    entityKey: snapshot.entityKey,
    label,
    subtitle,
    affectedScope: buildAffectedScope(linkedIssueKeys, liveContext.issueByKey, locale),
    projectId,
    projectKey,
    riskScore: snapshot.riskScore,
    riskLevel: snapshot.riskLevel as RiskLevel,
    reasons: toViewReasons(snapshot, locale),
    linkedIssueKeys,
    linkedIssueCount: linkedIssueKeys.length,
    timelineHref: buildTimelineHref(projectId),
    isNewRisk,
    isPersistentRisk,
    scoreDelta,
    computedAt: snapshot.computedAt.toISOString(),
  };
}

function entityMatchesFilters(params: {
  entity: RiskEntityView;
  liveContext: LiveEntityContext;
  projectId: string;
  component: string;
  assigneeFilter: AssigneeFilterValue;
}) {
  const issues = params.entity.linkedIssueKeys
    .map((issueKey) => params.liveContext.issueByKey.get(issueKey))
    .filter((issue): issue is RiskSourceIssueSnapshot => Boolean(issue));

  if (issues.length === 0) {
    return !params.projectId && !params.component && !params.assigneeFilter;
  }

  return issues.some(
    (issue) =>
      matchesProjectFilter(issue, params.projectId) &&
      matchesComponentFilter(issue, params.component) &&
      matchesAssigneeFilter(issue, params.assigneeFilter),
  );
}

function sortEntities(
  items: RiskEntityView[],
  sort: "score" | "freshness" = "score",
) {
  return [...items].sort((left, right) => {
    if (sort === "freshness") {
      if (left.isNewRisk !== right.isNewRisk) {
        return left.isNewRisk ? -1 : 1;
      }

      if (left.isPersistentRisk !== right.isPersistentRisk) {
        return left.isPersistentRisk ? -1 : 1;
      }
    }

    if (left.riskScore !== right.riskScore) {
      return right.riskScore - left.riskScore;
    }

    return left.label.localeCompare(right.label, "ru");
  });
}

function buildReasonBreakdown(
  items: RiskEntityView[],
  locale: AppLocale,
): RiskReasonBreakdownItem[] {
  const aggregates = new Map<
    RiskReasonCode,
    {
      count: number;
      totalWeight: number;
    }
  >();

  for (const item of items) {
    for (const reason of item.reasons) {
      const current = aggregates.get(reason.reasonCode) ?? {
        count: 0,
        totalWeight: 0,
      };

      current.count += 1;
      current.totalWeight += reason.weight;
      aggregates.set(reason.reasonCode, current);
    }
  }

  return [...aggregates.entries()]
    .map(([reasonCode, aggregate]) => ({
      reasonCode,
      title: describeRiskReason(locale, reasonCode, 0, {}).title,
      count: aggregate.count,
      totalWeight: aggregate.totalWeight,
    }))
    .sort((left, right) => {
      if (left.totalWeight !== right.totalWeight) {
        return right.totalWeight - left.totalWeight;
      }

      return left.title.localeCompare(right.title, "ru");
    });
}

function buildOverview(params: {
  issueViews: RiskEntityView[];
  epicViews: RiskEntityView[];
  projectViews: RiskEntityView[];
  hotspotViews: RiskEntityView[];
  allViews: RiskEntityView[];
  selectedProjectId: string;
  locale: AppLocale;
}): RiskOverview {
  const projectSummary =
    params.selectedProjectId
      ? params.projectViews.find((project) => project.projectId === params.selectedProjectId) ??
        null
      : sortEntities(params.projectViews).at(0) ?? null;
  const riskyIssuesCount = params.issueViews.filter((issue) =>
    isHighRiskLevel(issue.riskLevel),
  ).length;
  const riskyEpicsCount = params.epicViews.filter((epic) =>
    isHighRiskLevel(epic.riskLevel),
  ).length;
  const criticalHotspotsCount = params.hotspotViews.filter(
    (hotspot) => hotspot.riskLevel === "CRITICAL",
  ).length;
  const newRisksCount = params.allViews.filter(
    (item) => item.isNewRisk && item.riskLevel !== "LOW",
  ).length;

  return {
    projectSummary,
    riskyIssuesCount,
    riskyEpicsCount,
    criticalHotspotsCount,
    newRisksCount,
    distribution: [
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ].map((level) => ({
      level: level as RiskLevel,
      count: params.issueViews.filter((issue) => issue.riskLevel === level).length,
    })),
    topEpics: sortEntities(params.epicViews).slice(0, 8),
    topIssues: sortEntities(params.issueViews),
    hotspots: sortEntities(params.hotspotViews).slice(0, 10),
    reasonBreakdown: buildReasonBreakdown(params.allViews, params.locale),
  };
}

async function loadLatestSync(projectId: string, liveIssues: RiskSourceIssueSnapshot[]) {
  const scopedConnectionIds = projectId
    ? [...new Set(
        liveIssues
          .filter((issue) => issue.projectId === projectId)
          .map((issue) => issue.connectionId),
      )]
    : [...new Set(liveIssues.map((issue) => issue.connectionId))];

  if (scopedConnectionIds.length === 0) {
    return null;
  }

  const latestSync = await prisma.syncRun.findFirst({
    where: {
      status: SyncStatus.SUCCEEDED,
      jiraConnectionId: {
        in: scopedConnectionIds,
      },
    },
    orderBy: {
      startedAt: "desc",
    },
    select: {
      status: true,
      issuesFetched: true,
      requestedJql: true,
      finishedAt: true,
    },
  });

  return latestSync
    ? {
        status: latestSync.status,
        issuesFetched: latestSync.issuesFetched,
        requestedJql: latestSync.requestedJql ?? "",
        finishedAt: latestSync.finishedAt?.toISOString() ?? null,
      }
    : null;
}

async function loadCurrentSnapshots() {
  const latestBatches = await prisma.riskSnapshot.groupBy({
    by: ["jiraConnectionId"],
    _max: {
      computedAt: true,
    },
  });
  const currentBatchFilters = latestBatches.flatMap((batch) =>
    batch._max.computedAt
      ? [
          {
            jiraConnectionId: batch.jiraConnectionId,
            computedAt: batch._max.computedAt,
          },
        ]
      : [],
  );

  if (currentBatchFilters.length === 0) {
    return {
      currentSnapshots: [] as PersistedRiskSnapshot[],
      historySnapshots: [] as PersistedRiskSnapshot[],
    };
  }

  const currentSnapshots = await prisma.riskSnapshot.findMany({
    where: {
      OR: currentBatchFilters,
    },
    select: riskSnapshotSelect,
  });

  const entityFilters = currentSnapshots.map((snapshot) => ({
    jiraConnectionId: snapshot.jiraConnectionId,
    entityType: snapshot.entityType,
    entityKey: snapshot.entityKey,
  }));

  const historySnapshots =
    entityFilters.length > 0
      ? await prisma.riskSnapshot.findMany({
          where: {
            OR: entityFilters,
          },
          orderBy: [
            {
              jiraConnectionId: "asc",
            },
            {
              entityType: "asc",
            },
            {
              entityKey: "asc",
            },
            {
              computedAt: "desc",
            },
          ],
          select: riskSnapshotSelect,
        })
      : [];

  return {
    currentSnapshots,
    historySnapshots,
  };
}

async function loadRiskRadarState(input: LoadStateInput = {}): Promise<LoadStateResult> {
  const locale = input.locale ?? DEFAULT_APP_LOCALE;
  const copy = getRiskRadarCopy(locale);
  const projectFilterOptions = await loadProjectFilterOptions();
  const selectedProjectId = projectFilterOptions.some(
    (option) => option.id === input.project,
  )
    ? input.project ?? ""
    : "";
  const liveIssues = await loadRiskSourceIssues(selectedProjectId || undefined, locale);
  const componentOptions = [...new Set(liveIssues.flatMap((issue) => issue.componentNames))]
    .sort((left, right) => left.localeCompare(right, "ru"));
  const selectedComponent = componentOptions.includes(input.component ?? "")
    ? input.component ?? ""
    : "";
  const assigneeOptions = [...new Map(
    liveIssues.map((issue) => [
      `${issue.connectionId}:${issue.assigneeEntityKey}`,
      {
        key: `${issue.connectionId}:${issue.assigneeEntityKey}`,
        label: `${issue.assigneeName} (${issue.connectionName})`,
      },
    ]),
  ).values()].sort((left, right) => left.label.localeCompare(right.label, "ru"));
  const selectedAssignee = assigneeOptions.some((option) => option.key === input.assignee)
    ? input.assignee ?? ""
    : "";
  const assigneeFilter = parseAssigneeFilter(selectedAssignee);
  const liveContext = buildLiveContext(liveIssues);
  const latestSync = await loadLatestSync(selectedProjectId, liveIssues);
  const { currentSnapshots, historySnapshots } = await loadCurrentSnapshots();

  if (currentSnapshots.length === 0) {
    return {
      allViews: [],
      issueViews: [],
      epicViews: [],
      projectViews: [],
      hotspotViews: [],
      selectedEntity: null,
      latestRunAt: null,
      previousRunAt: null,
      latestSync,
      filterOptions: {
        projects: projectFilterOptions,
        components: componentOptions,
        assignees: assigneeOptions,
      },
      filters: {
        project: selectedProjectId,
        component: selectedComponent,
        assignee: selectedAssignee,
      },
      emptyStateMessage:
        liveIssues.length === 0
          ? copy.runSyncFirst
          : copy.snapshotsUnavailable,
    };
  }

  const historyByEntity = new Map<string, PersistedRiskSnapshot[]>();

  for (const snapshot of historySnapshots) {
    const historyKey = toScopedSnapshotKey(
      snapshot.jiraConnectionId,
      snapshot.entityType as RiskEntityType,
      snapshot.entityKey,
    );
    const group = historyByEntity.get(historyKey) ?? [];

    group.push(snapshot);
    historyByEntity.set(historyKey, group);
  }

  const currentViews = currentSnapshots.map((snapshot) => {
    const historyKey = toScopedSnapshotKey(
      snapshot.jiraConnectionId,
      snapshot.entityType as RiskEntityType,
      snapshot.entityKey,
    );
    const history = historyByEntity.get(historyKey) ?? [];
    const previousSnapshot =
      history.find((item) => item.computedAt.getTime() < snapshot.computedAt.getTime()) ?? null;

    return toRiskEntityView({
      snapshot,
      previousSnapshot,
      liveContext,
      locale,
    });
  });

  const filteredViews = currentViews.filter((entity) =>
    entityMatchesFilters({
      entity,
      liveContext,
      projectId: selectedProjectId,
      component: selectedComponent,
      assigneeFilter,
    }),
  );

  const issueViews = filteredViews.filter(
    (entity) => entity.entityType === "ISSUE" && entity.riskScore > 0,
  );
  const epicViews = filteredViews.filter(
    (entity) => entity.entityType === "EPIC" && entity.riskScore > 0,
  );
  const projectViews = filteredViews.filter(
    (entity) => entity.entityType === "PROJECT" && entity.riskScore > 0,
  );
  const hotspotViews = filteredViews.filter(
    (entity) =>
      (entity.entityType === "ASSIGNEE" || entity.entityType === "COMPONENT") &&
      entity.riskScore > 0,
  );
  const selectedSnapshot = input.entityId
    ? currentSnapshots.find((snapshot) => snapshot.id === input.entityId) ?? null
    : null;

  let selectedEntity: RiskEntityDetail | null = null;

  if (selectedSnapshot) {
    const history = await prisma.riskSnapshot.findMany({
      where: {
        jiraConnectionId: selectedSnapshot.jiraConnectionId,
        entityType: selectedSnapshot.entityType,
        entityKey: selectedSnapshot.entityKey,
      },
      orderBy: {
        computedAt: "desc",
      },
      take: 8,
      select: riskSnapshotSelect,
    });
    const selectedHistoryKey = toScopedSnapshotKey(
      selectedSnapshot.jiraConnectionId,
      selectedSnapshot.entityType as RiskEntityType,
      selectedSnapshot.entityKey,
    );
    const currentView =
      currentViews.find((view) => view.id === selectedSnapshot.id) ??
      toRiskEntityView({
        snapshot: selectedSnapshot,
        previousSnapshot:
          history.find(
            (item) => item.computedAt.getTime() < selectedSnapshot.computedAt.getTime(),
          ) ?? null,
        liveContext,
        locale,
      });

    selectedEntity = {
      ...currentView,
      history: history
        .map((snapshot) => ({
          computedAt: snapshot.computedAt.toISOString(),
          riskScore: snapshot.riskScore,
          riskLevel: snapshot.riskLevel as RiskLevel,
          isCurrent: snapshot.id === selectedSnapshot.id,
        }))
        .reverse(),
      linkedIssues: sortEntities(
        currentViews.filter(
          (view) =>
            view.entityType === "ISSUE" &&
            currentView.linkedIssueKeys.includes(view.entityKey),
        ),
      ),
    };

    if (!historyByEntity.has(selectedHistoryKey)) {
      historyByEntity.set(selectedHistoryKey, history);
    }
  }

  const latestRunAt = currentViews
    .map((item) => item.computedAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const previousRunAt =
    historySnapshots
      .map((snapshot) => snapshot.computedAt.toISOString())
      .filter((timestamp) => timestamp !== latestRunAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    allViews: filteredViews.filter((entity) => entity.riskScore > 0),
    issueViews,
    epicViews,
    projectViews,
    hotspotViews,
    selectedEntity,
    latestRunAt,
    previousRunAt,
    latestSync,
    filterOptions: {
      projects: projectFilterOptions,
      components: componentOptions,
      assignees: assigneeOptions,
    },
    filters: {
      project: selectedProjectId,
      component: selectedComponent,
      assignee: selectedAssignee,
    },
    emptyStateMessage:
      filteredViews.length === 0 ? copy.noRisksMatchFilters : null,
  };
}

export async function recomputeRiskSnapshotsForConnection(params: {
  jiraConnectionId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const [connection, thresholds, issues] = await Promise.all([
    prisma.jiraConnection.findUnique({
      where: {
        id: params.jiraConnectionId,
      },
      select: {
        id: true,
        timezone: true,
      },
    }),
    ensureThresholdConfig(params.jiraConnectionId),
    prisma.issue.findMany({
      where: {
        issueType: {
          not: "Epic",
        },
        project: {
          jiraConnectionId: params.jiraConnectionId,
        },
      },
      select: riskSourceIssueSelect,
    }),
  ]);

  if (!connection) {
    throw new Error("Jira connection not found.");
  }

  const issueSources = buildIssueSources(issues, DEFAULT_APP_LOCALE);
  const computedAt = now;
  const snapshotDate = getStartOfDay(now, connection.timezone);
  const { persistable } = buildPersistableSnapshots({
    issues: issueSources,
    thresholds,
    now,
  });

  await prisma.$transaction(async (tx) => {
    for (const snapshot of persistable) {
      await tx.riskSnapshot.create({
        data: {
          jiraConnectionId: snapshot.jiraConnectionId,
          jiraProjectId: snapshot.jiraProjectId,
          epicId: snapshot.epicId,
          issueId: snapshot.issueId,
          entityType: snapshot.entityType as PrismaRiskEntityType,
          entityKey: snapshot.entityKey,
          riskScore: snapshot.riskScore,
          riskLevel: snapshot.riskLevel as PrismaRiskLevel,
          computedAt,
          snapshotDate,
          ...(snapshot.reasons.length > 0
            ? {
                reasons: {
                  create: snapshot.reasons.map((reason) => ({
                    reasonCode: reason.reasonCode as PrismaRiskReasonCode,
                    weight: reason.weight,
                    detailsJson: toPrismaJson(reason.details),
                  })),
                },
              }
            : {}),
        },
      });
    }
  });

  return {
    jiraConnectionId: params.jiraConnectionId,
    computedAt: computedAt.toISOString(),
    snapshotDate: snapshotDate.toISOString(),
    totalSnapshots: persistable.length,
    issueSnapshots: persistable.filter((item) => item.entityType === "ISSUE").length,
    epicSnapshots: persistable.filter((item) => item.entityType === "EPIC").length,
    projectSnapshots: persistable.filter((item) => item.entityType === "PROJECT").length,
    hotspotSnapshots: persistable.filter(
      (item) => item.entityType === "ASSIGNEE" || item.entityType === "COMPONENT",
    ).length,
  };
}

export async function recomputeRiskSnapshots(params: {
  jiraConnectionId?: string;
  projectId?: string;
  now?: Date;
} = {}) {
  const scopedProject =
    params.projectId
      ? await prisma.jiraProject.findUnique({
          where: {
            id: params.projectId,
          },
          select: {
            jiraConnectionId: true,
          },
        })
      : null;
  const connectionIds =
    params.jiraConnectionId
      ? [params.jiraConnectionId]
      : scopedProject?.jiraConnectionId
        ? [scopedProject.jiraConnectionId]
        : (
            await prisma.jiraConnection.findMany({
              select: {
                id: true,
              },
            })
          ).map((connection) => connection.id);

  if (connectionIds.length === 0) {
    return {
      recomputed: [],
      totalSnapshots: 0,
    };
  }

  const recomputed = [];

  for (const jiraConnectionId of connectionIds) {
    recomputed.push(
      await recomputeRiskSnapshotsForConnection({
        jiraConnectionId,
        now: params.now,
      }),
    );
  }

  return {
    recomputed,
    totalSnapshots: recomputed.reduce(
      (sum, item) => sum + item.totalSnapshots,
      0,
    ),
  };
}

export async function loadRiskRadarDashboard(
  input: LoadStateInput = {},
): Promise<RiskRadarDashboard> {
  const state = await loadRiskRadarState(input);

  return {
    overview: buildOverview({
      issueViews: state.issueViews,
      epicViews: state.epicViews,
      projectViews: state.projectViews,
      hotspotViews: state.hotspotViews,
      allViews: state.allViews,
      selectedProjectId: state.filters.project,
      locale: input.locale ?? DEFAULT_APP_LOCALE,
    }),
    selectedEntity: state.selectedEntity,
    latestRunAt: state.latestRunAt,
    previousRunAt: state.previousRunAt,
    latestSync: state.latestSync,
    filterOptions: state.filterOptions,
    filters: state.filters,
    emptyStateMessage: state.emptyStateMessage,
  };
}

export async function loadRiskRadarOverviewForApi(input: LoadStateInput = {}) {
  const dashboard = await loadRiskRadarDashboard(input);

  return dashboard.overview;
}

export async function loadRiskRadarEntities(input: LoadStateInput & {
  entityType?: string;
  sort?: "score" | "freshness";
  limit?: number;
} = {}) {
  const state = await loadRiskRadarState(input);
  const normalizedEntityType = (input.entityType ?? "").toUpperCase();
  const entityTypeFilter = new Set(
    normalizedEntityType
      ? normalizedEntityType.split(",").map((value) => value.trim()).filter(Boolean)
      : [],
  );
  const filtered =
    entityTypeFilter.size > 0
      ? state.allViews.filter((entity) => entityTypeFilter.has(entity.entityType))
      : state.allViews;

  return sortEntities(filtered, input.sort).slice(
    0,
    input.limit && input.limit > 0 ? input.limit : filtered.length,
  );
}

export async function loadRiskRadarEntityDetailBySnapshotId(id: string) {
  const dashboard = await loadRiskRadarDashboard({
    entityId: id,
  });

  return dashboard.selectedEntity;
}
