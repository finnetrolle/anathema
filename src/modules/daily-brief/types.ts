export const DAILY_BRIEF_SCOPE_TYPES = ["TEAM", "PROJECT", "PERSON"] as const;
export type DailyBriefScopeType = (typeof DAILY_BRIEF_SCOPE_TYPES)[number];

export const DAILY_BRIEF_WINDOW_PRESETS = [
  "PREVIOUS_BUSINESS_DAY",
  "LAST_24H",
  "CUSTOM",
] as const;
export type DailyBriefWindowPreset = (typeof DAILY_BRIEF_WINDOW_PRESETS)[number];

export const DAILY_BRIEF_ITEM_TYPES = [
  "COMPLETED",
  "STARTED",
  "STALE_IN_PROGRESS",
  "OVERDUE",
  "MISSING_DUE_DATE",
  "MISSING_ESTIMATE",
  "NO_CODE_ACTIVITY",
  "OWNERSHIP_CHANGED",
  "DONE_WITHOUT_PR",
  "REOPENED",
] as const;
export type DailyBriefItemType = (typeof DAILY_BRIEF_ITEM_TYPES)[number];

export const DAILY_BRIEF_IMPORTANCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type DailyBriefImportance = (typeof DAILY_BRIEF_IMPORTANCE_LEVELS)[number];

export type DailyBriefWindow = {
  preset: DailyBriefWindowPreset;
  start: Date;
  end: Date;
  label: string;
  startInput: string;
  endInput: string;
};

export type DailyBriefScope = {
  type: DailyBriefScopeType;
  key: string;
  label: string;
  connectionId: string;
  connectionName: string;
  timezone: string;
};

export type DailyBriefCounts = {
  completedCount: number;
  startedCount: number;
  attentionCount: number;
  ownershipChangesCount: number;
  peopleCovered: number;
};

export type DailyBriefItemDetails = {
  reason: string;
  startAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  status: string;
  projectKey: string;
  projectName: string;
  epicKey: string | null;
  epicSummary: string | null;
  componentName: string;
  assigneeHistory: string[];
  observedPeople: string[];
  estimateHours: number | null;
  estimateStoryPoints: number | null;
  commitCount: number;
  pullRequestCount: number;
  pullRequestStatus: "OPEN" | "MERGED" | "DECLINED" | "NONE";
  currentAssigneeName: string;
  changedAt: string | null;
  previousAssigneeName: string | null;
  nextAssigneeName: string | null;
};

export type DailyBriefViewItem = {
  id: string;
  issueJiraId: string | null;
  issueKey: string;
  issueSummary: string;
  issueUrl: string | null;
  assigneeName: string;
  projectKey: string;
  projectName: string;
  epicKey: string | null;
  epicSummary: string | null;
  componentName: string;
  itemType: DailyBriefItemType;
  importance: DailyBriefImportance;
  headline: string;
  details: DailyBriefItemDetails;
  createdAt: string;
};

export type DailyBriefSummary = {
  headline: string;
  generatedAt: string;
  generatedForDate: string;
  windowStart: string;
  windowEnd: string;
  counts: DailyBriefCounts;
  people: string[];
};

export type DailyBriefView = {
  id: string;
  scope: DailyBriefScope;
  window: DailyBriefWindow;
  status: "SUCCEEDED" | "FAILED";
  summary: DailyBriefSummary;
  items: DailyBriefViewItem[];
  sections: {
    completed: DailyBriefViewItem[];
    started: DailyBriefViewItem[];
    needsAttention: DailyBriefViewItem[];
    ownershipChanges: DailyBriefViewItem[];
    topicsForStandup: DailyBriefViewItem[];
  };
  createdAt: string;
  updatedAt: string;
};

export type DailyBriefHistoryEntry = {
  id: string;
  createdAt: string;
  generatedForDate: string;
  scopeType: DailyBriefScopeType;
  scopeKey: string;
  scopeLabel: string;
  headline: string;
  counts: DailyBriefCounts;
};

export type DailyBriefDashboard = {
  brief: DailyBriefView | null;
  latestSync:
    | {
        status: string;
        issuesFetched: number;
        requestedJql: string;
        finishedAt: string | null;
      }
    | null;
  scope: DailyBriefScope | null;
  scopeOptions: {
    projects: Array<{
      key: string;
      label: string;
    }>;
    people: Array<{
      key: string;
      label: string;
      color: string;
    }>;
  };
  window: DailyBriefWindow | null;
  history: DailyBriefHistoryEntry[];
  filters: {
    scopeType: DailyBriefScopeType;
    project: string;
    person: string;
    preset: DailyBriefWindowPreset;
    from: string;
    to: string;
    actionableOnly: boolean;
  };
};
