const DEFAULT_IN_PROGRESS_STATUSES = [
  "In Progress",
  "Development",
  "Coding",
  "Code Review",
  "In QA",
  "QA",
] as const;
const DEFAULT_DONE_STATUSES = [
  "Done",
  "Closed",
  "Resolved",
  "Completed",
] as const;

type ResolveWorkflowRulesOptions = {
  connectionId?: string | null;
  connectionName?: string | null;
};

type JiraWorkflowRulesConfig = {
  inProgressStatuses: string[];
  doneStatuses: string[];
};

export type JiraWorkflowRules = JiraWorkflowRulesConfig & {
  inProgressStatusSet: ReadonlySet<string>;
  doneStatusSet: ReadonlySet<string>;
  usesFallback: boolean;
};

const warnedFallbackConnections = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkflowStatusName(status?: string | null) {
  const normalized = status?.trim();

  return normalized ? normalized.toLocaleLowerCase() : null;
}

export function normalizeStatusCategoryKey(categoryKey?: string | null) {
  const normalized = categoryKey?.trim().toLocaleLowerCase();

  return normalized === "done" ||
    normalized === "indeterminate" ||
    normalized === "new"
    ? normalized
    : null;
}

function normalizeStatusList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const statuses: string[] = [];
  const seenStatuses = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    const normalizedKey = normalizeWorkflowStatusName(normalized);

    if (!normalized || !normalizedKey || seenStatuses.has(normalizedKey)) {
      continue;
    }

    seenStatuses.add(normalizedKey);
    statuses.push(normalized);
  }

  return statuses;
}

function buildWorkflowRules(
  config: JiraWorkflowRulesConfig,
  usesFallback: boolean,
): JiraWorkflowRules {
  return {
    inProgressStatuses: [...config.inProgressStatuses],
    doneStatuses: [...config.doneStatuses],
    inProgressStatusSet: new Set(
      config.inProgressStatuses
        .map((status) => normalizeWorkflowStatusName(status))
        .filter((status): status is string => Boolean(status)),
    ),
    doneStatusSet: new Set(
      config.doneStatuses
        .map((status) => normalizeWorkflowStatusName(status))
        .filter((status): status is string => Boolean(status)),
    ),
    usesFallback,
  };
}

function formatConnectionLabel(options: ResolveWorkflowRulesOptions) {
  const connectionName = options.connectionName?.trim();
  const connectionId = options.connectionId?.trim();

  if (connectionName && connectionId) {
    return `${connectionName} (${connectionId})`;
  }

  if (connectionName) {
    return connectionName;
  }

  if (connectionId) {
    return connectionId;
  }

  return "unknown Jira connection";
}

function warnWorkflowRulesFallback(options: ResolveWorkflowRulesOptions) {
  const warningKey = options.connectionId?.trim() || options.connectionName?.trim();

  if (!warningKey || warnedFallbackConnections.has(warningKey)) {
    return;
  }

  warnedFallbackConnections.add(warningKey);
  console.warn(
    `[jira] Workflow rules are not configured for ${formatConnectionLabel(options)}. Falling back to default status lists.`,
  );
}

function getDefaultWorkflowRulesConfig(): JiraWorkflowRulesConfig {
  return {
    inProgressStatuses: [...DEFAULT_IN_PROGRESS_STATUSES],
    doneStatuses: [...DEFAULT_DONE_STATUSES],
  };
}

export function getDefaultWorkflowRules() {
  return buildWorkflowRules(getDefaultWorkflowRulesConfig(), true);
}

export function resolveWorkflowRules(
  rawRules: unknown,
  options: ResolveWorkflowRulesOptions = {},
) {
  const rulesRecord = isRecord(rawRules) ? rawRules : null;
  const inProgressStatuses = normalizeStatusList(
    rulesRecord?.inProgressStatuses,
  );
  const doneStatuses = normalizeStatusList(rulesRecord?.doneStatuses);
  const usesFallback =
    inProgressStatuses.length === 0 || doneStatuses.length === 0;

  if (usesFallback) {
    warnWorkflowRulesFallback(options);
  }

  return buildWorkflowRules(
    {
      inProgressStatuses:
        inProgressStatuses.length > 0
          ? inProgressStatuses
          : [...DEFAULT_IN_PROGRESS_STATUSES],
      doneStatuses:
        doneStatuses.length > 0 ? doneStatuses : [...DEFAULT_DONE_STATUSES],
    },
    usesFallback,
  );
}
