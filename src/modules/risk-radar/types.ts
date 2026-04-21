export const RISK_ENTITY_TYPES = [
  "PROJECT",
  "EPIC",
  "ISSUE",
  "ASSIGNEE",
  "COMPONENT",
] as const;

export type RiskEntityType = (typeof RISK_ENTITY_TYPES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_REASON_CODES = [
  "OVERDUE",
  "AGING_WIP",
  "MISSING_ESTIMATE",
  "MISSING_DUE_DATE",
  "NO_DEV_ACTIVITY",
  "ASSIGNEE_CHURN",
  "REOPENED",
  "HIGH_RISK_CHILDREN",
  "SPREAD_RISK",
  "CONCENTRATION_RISK",
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

export type RiskThresholds = {
  agingDaysWarning: number;
  agingDaysCritical: number;
  reassignmentsThreshold: number;
  staleDevActivityDays: number;
  epicHighRiskIssueCount: number;
};

export type DerivedRiskReason = {
  reasonCode: RiskReasonCode;
  weight: number;
  details: Record<string, unknown>;
};

export type RiskReasonView = {
  reasonCode: RiskReasonCode;
  weight: number;
  title: string;
  narrative: string;
  recommendedAction: string;
  details: Record<string, unknown>;
};

export type RiskEntityView = {
  id: string;
  entityType: RiskEntityType;
  entityKey: string;
  label: string;
  subtitle: string;
  affectedScope: string;
  projectId: string | null;
  projectKey: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: RiskReasonView[];
  linkedIssueKeys: string[];
  linkedIssueCount: number;
  timelineHref: string;
  isNewRisk: boolean;
  isPersistentRisk: boolean;
  scoreDelta: number | null;
  computedAt: string;
};

export type RiskTrendPoint = {
  computedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
  isCurrent: boolean;
};

export type RiskEntityDetail = RiskEntityView & {
  history: RiskTrendPoint[];
  linkedIssues: RiskEntityView[];
};

export type RiskReasonBreakdownItem = {
  reasonCode: RiskReasonCode;
  title: string;
  count: number;
  totalWeight: number;
};

export type RiskLevelDistributionItem = {
  level: RiskLevel;
  count: number;
};

export type RiskOverview = {
  projectSummary: RiskEntityView | null;
  riskyIssuesCount: number;
  riskyEpicsCount: number;
  criticalHotspotsCount: number;
  newRisksCount: number;
  distribution: RiskLevelDistributionItem[];
  topEpics: RiskEntityView[];
  topIssues: RiskEntityView[];
  hotspots: RiskEntityView[];
  reasonBreakdown: RiskReasonBreakdownItem[];
};

export type RiskRadarDashboard = {
  overview: RiskOverview;
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
  filterOptions: {
    projects: Array<{
      id: string;
      label: string;
    }>;
    components: string[];
    assignees: Array<{
      key: string;
      label: string;
    }>;
  };
  filters: {
    project: string;
    component: string;
    assignee: string;
  };
  emptyStateMessage: string | null;
};
