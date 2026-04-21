import type {
  RiskLevel,
  RiskReasonView,
} from "@/modules/risk-radar/types";

export type TimelineMarkerKind = "DONE" | "DUE" | "NONE";
export type TimelinePullRequestStatus =
  | "OPEN"
  | "MERGED"
  | "DECLINED"
  | "NONE";

export type TimelineIssue = {
  id: string;
  key: string;
  summary: string;
  issueUrl: string | null;
  timezone: string;
  componentName: string;
  epicId: string;
  epicKey: string;
  epicSummary: string;
  assigneeName: string;
  assigneeColor: string;
  status: string;
  isCompleted: boolean;
  createdAt: string | null;
  startAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  estimateHours: number | null;
  estimateStoryPoints: number | null;
  observedPeople: string[];
  assigneeHistory: string[];
  authorName: string | null;
  markerAt: string | null;
  markerKind: TimelineMarkerKind;
  pullRequestStatus: TimelinePullRequestStatus;
  pullRequestCount: number;
  commitCount: number;
  isMissingDueDate: boolean;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  riskReasons: RiskReasonView[];
};

export type TimelineEpic = {
  id: string;
  componentName: string;
  key: string;
  summary: string;
  issues: TimelineIssue[];
};

export type TimelineColumn = {
  key: string;
  dayKey: string;
  label: string;
  isWeekStart: boolean;
  isToday: boolean;
  weekLabel: string | null;
};

export type TimelineLegendItem = {
  personName: string;
  color: string;
};

export type TimelineRowItem = {
  issueId: string;
  issueKey: string;
  summary: string;
  issueUrl: string | null;
  assigneeName: string;
  assigneeColor: string;
  statusLabel: string;
  isCompleted: boolean;
  markerKind: TimelineMarkerKind;
  markerLabel: string;
  createdLabel: string | null;
  startLabel: string | null;
  dueLabel: string | null;
  resolvedLabel: string | null;
  estimateHours: number | null;
  estimateStoryPoints: number | null;
  observedPeople: string[];
  assigneeHistory: string[];
  authorName: string | null;
  pullRequestStatus: TimelinePullRequestStatus;
  pullRequestCount: number;
  commitCount: number;
  isMissingDueDate: boolean;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  riskReasons: RiskReasonView[];
  startColumn: number;
  span: number;
};

export type TimelineRow = {
  componentName: string;
  epicId: string;
  epicKey: string;
  epicSummary: string;
  items: TimelineRowItem[];
};

export type TimelineModel = {
  timezones: string[];
  columns: TimelineColumn[];
  rows: TimelineRow[];
  legend: TimelineLegendItem[];
  rangeLabel: string;
  rangeStartInput: string;
  rangeEndInput: string;
  dayWidth: number;
};
