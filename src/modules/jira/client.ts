import type {
  JiraFieldDefinition,
  JiraIssue,
  JiraSearchResponse,
} from "@/modules/jira/types";
import { throwIfAborted } from "@/modules/jira/abort";

type SearchJiraIssuesInput = {
  jql?: string;
  maxResults?: number;
  runtime?: JiraRuntimeConfig;
  signal?: AbortSignal;
};

type SearchJiraIssuesPageInput = SearchJiraIssuesInput & {
  startAt?: number;
  minResults?: number;
};

type JiraAuthMode = "basic" | "bearer";
type JiraApiVersion = "2" | "3";

type JiraCredentials = {
  connectionName: string;
  baseUrl: string;
  email?: string;
  apiToken: string;
  defaultJql: string;
  timezone: string;
  authMode: JiraAuthMode | "auto";
  apiVersion: JiraApiVersion | "auto";
};

export type JiraRuntimeConfig = {
  connectionName: string;
  baseUrl: string;
  defaultJql: string;
  timezone: string;
  authMode: JiraAuthMode;
  apiVersion: JiraApiVersion;
  authHeader: string;
  epicLinkFieldId?: string;
  storyPointFieldIds?: string[];
  developmentFieldIds?: string[];
};

const DEFAULT_FIELDS = [
  "project",
  "summary",
  "status",
  "assignee",
  "priority",
  "components",
  "duedate",
  "resolutiondate",
  "issuetype",
  "parent",
  "creator",
  "reporter",
  "timeoriginalestimate",
  "aggregatetimeoriginalestimate",
  "created",
  "updated",
];

const STORY_POINT_NAME_PATTERN = /^story point(s)?( estimate| estimation)?$/i;
const RETRYABLE_SEARCH_STATUSES = new Set([408, 429, 502, 503, 504]);
const MIN_JIRA_PAGE_SIZE = 10;

export function readJiraCredentials(): JiraCredentials {
  const connectionName = process.env.JIRA_CONNECTION_NAME ?? "Primary Jira";
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const defaultJql = process.env.JIRA_DEFAULT_JQL;
  const timezone = process.env.TIMELINE_TIMEZONE ?? "Europe/Moscow";
  const authMode = (process.env.JIRA_AUTH_MODE ?? "auto") as
    | JiraAuthMode
    | "auto";
  const apiVersion = (process.env.JIRA_API_VERSION ?? "auto") as
    | JiraApiVersion
    | "auto";

  if (!baseUrl || !apiToken || !defaultJql) {
    throw new Error(
      "Missing Jira environment variables. Fill JIRA_BASE_URL, JIRA_API_TOKEN, and JIRA_DEFAULT_JQL.",
    );
  }

  return {
    connectionName,
    baseUrl,
    email,
    apiToken,
    defaultJql,
    timezone,
    authMode,
    apiVersion,
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function buildBaseUrlCandidates(baseUrl: string) {
  const normalized = trimTrailingSlash(baseUrl);
  const parsed = new URL(normalized);
  const candidates = new Set<string>([normalized]);

  if (parsed.pathname !== "/jira") {
    candidates.add(`${parsed.origin}/jira`);
  }

  if (parsed.pathname.includes("/stash") || parsed.pathname.includes("/bitbucket")) {
    candidates.add(`${parsed.origin}/jira`);
  }

  return [...candidates];
}

function buildAuthModes(credentials: JiraCredentials): JiraAuthMode[] {
  if (credentials.authMode === "basic") {
    if (!credentials.email) {
      throw new Error("JIRA_EMAIL is required when JIRA_AUTH_MODE=basic.");
    }

    return ["basic"];
  }

  if (credentials.authMode === "bearer") {
    return ["bearer"];
  }

  const preferBasic = credentials.baseUrl.includes("atlassian.net");

  if (!credentials.email) {
    return ["bearer"];
  }

  return preferBasic ? ["basic", "bearer"] : ["bearer", "basic"];
}

function buildApiVersions(credentials: JiraCredentials): JiraApiVersion[] {
  if (credentials.apiVersion === "2" || credentials.apiVersion === "3") {
    return [credentials.apiVersion];
  }

  return credentials.baseUrl.includes("atlassian.net") ? ["3", "2"] : ["2", "3"];
}

function createAuthHeader(
  mode: JiraAuthMode,
  email: string | undefined,
  apiToken: string,
) {
  if (mode === "bearer") {
    return `Bearer ${apiToken}`;
  }

  if (!email) {
    throw new Error("JIRA_EMAIL is required for basic Jira authentication.");
  }

  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

async function fetchJson<T>(
  input: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  throwIfAborted(init.signal ?? undefined);
  const response = await fetch(input, init);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: (await response.json()) as T,
  };
}

async function fetchFieldDefinitions(
  runtime: JiraRuntimeConfig,
  signal?: AbortSignal,
) {
  const response = await fetchJson<JiraFieldDefinition[]>(
    `${runtime.baseUrl}/rest/api/${runtime.apiVersion}/field`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: runtime.authHeader,
      },
      cache: "no-store",
      signal,
    },
  );

  return response.ok && response.data ? response.data : [];
}

function detectEpicLinkFieldId(fieldDefinitions: JiraFieldDefinition[]) {
  return fieldDefinitions.find(
    (field) =>
      field.name === "Epic Link" ||
      field.schema?.custom === "com.pyxis.greenhopper.jira:gh-epic-link",
  )?.id;
}

function detectStoryPointFieldIds(fieldDefinitions: JiraFieldDefinition[]) {
  return fieldDefinitions
    .filter((field) => {
      const fieldName = field.name.trim();
      const isCustomNumberField =
        field.id.startsWith("customfield_") &&
        (field.schema?.type === "number" ||
          field.schema?.custom?.includes("float") ||
          field.schema?.custom?.includes("number"));

      return isCustomNumberField && STORY_POINT_NAME_PATTERN.test(fieldName);
    })
    .map((field) => field.id);
}

function detectDevelopmentFieldIds(fieldDefinitions: JiraFieldDefinition[]) {
  return fieldDefinitions
    .filter((field) => {
      const fieldName = field.name.trim().toLowerCase();
      const customType = field.schema?.custom?.toLowerCase() ?? "";

      return (
        fieldName === "development" ||
        customType.includes("jira-development-integration-plugin:devsummary") ||
        customType.includes("devsummary")
      );
    })
    .map((field) => field.id);
}

export async function resolveJiraRuntimeConfig(
  signal?: AbortSignal,
): Promise<JiraRuntimeConfig> {
  const credentials = readJiraCredentials();
  const baseUrlCandidates = buildBaseUrlCandidates(credentials.baseUrl);
  const authModes = buildAuthModes(credentials);
  const apiVersions = buildApiVersions(credentials);

  for (const baseUrl of baseUrlCandidates) {
    for (const authMode of authModes) {
      throwIfAborted(signal);
      const authHeader = createAuthHeader(
        authMode,
        credentials.email,
        credentials.apiToken,
      );

      for (const apiVersion of apiVersions) {
        const response = await fetchJson<Record<string, unknown>>(
          `${baseUrl}/rest/api/${apiVersion}/serverInfo`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: authHeader,
            },
            cache: "no-store",
            signal,
          },
        );

        if (!response.ok) {
          continue;
        }

        const runtime: JiraRuntimeConfig = {
          connectionName: credentials.connectionName,
          baseUrl,
          defaultJql: credentials.defaultJql,
          timezone: credentials.timezone,
          authMode,
          apiVersion,
          authHeader,
        };

        const fieldDefinitions = await fetchFieldDefinitions(runtime, signal);

        runtime.epicLinkFieldId = detectEpicLinkFieldId(fieldDefinitions);
        runtime.storyPointFieldIds = detectStoryPointFieldIds(fieldDefinitions);
        runtime.developmentFieldIds = detectDevelopmentFieldIds(fieldDefinitions);

        return runtime;
      }
    }
  }

  throw new Error(
    "Unable to authenticate against Jira with the configured base URL and credentials.",
  );
}

export async function searchJiraIssues({
  jql,
  maxResults = 100,
  runtime,
  signal,
}: SearchJiraIssuesInput): Promise<{
  issues: JiraIssue[];
  runtime: JiraRuntimeConfig;
}> {
  const activeRuntime = runtime ?? (await resolveJiraRuntimeConfig(signal));
  const issues: JiraIssue[] = [];
  let startAt = 0;

  while (true) {
    const page = await searchJiraIssuesPage({
      jql,
      startAt,
      maxResults,
      runtime: activeRuntime,
      signal,
    });

    issues.push(...page.issues);

    const fetchedCount = page.startAt + page.issues.length;

    if (fetchedCount >= page.total || page.issues.length === 0) {
      break;
    }

    startAt = fetchedCount;
  }

  return {
    issues,
    runtime: activeRuntime,
  };
}

export async function searchJiraIssuesPage({
  jql,
  startAt = 0,
  maxResults = 100,
  minResults = MIN_JIRA_PAGE_SIZE,
  runtime,
  signal,
}: SearchJiraIssuesPageInput): Promise<
  JiraSearchResponse & { runtime: JiraRuntimeConfig }
> {
  const activeRuntime = runtime ?? (await resolveJiraRuntimeConfig(signal));
  const fields = [
    ...new Set([
      ...DEFAULT_FIELDS,
      activeRuntime.epicLinkFieldId,
      ...(activeRuntime.storyPointFieldIds ?? []),
      ...(activeRuntime.developmentFieldIds ?? []),
    ].filter((value): value is string => Boolean(value))),
  ];
  const normalizedMinResults = Math.max(1, Math.min(minResults, maxResults));
  let pageSize = Math.max(maxResults, normalizedMinResults);

  while (true) {
    throwIfAborted(signal);
    const response = await fetch(
      `${activeRuntime.baseUrl}/rest/api/${activeRuntime.apiVersion}/search`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: activeRuntime.authHeader,
        },
        body: JSON.stringify({
          jql: jql ?? activeRuntime.defaultJql,
          startAt,
          maxResults: pageSize,
          fields,
          expand: ["changelog"],
        }),
        cache: "no-store",
        signal,
      },
    );

    if (!response.ok && RETRYABLE_SEARCH_STATUSES.has(response.status)) {
      const nextPageSize = Math.max(
        normalizedMinResults,
        Math.floor(pageSize / 2),
      );

      if (nextPageSize < pageSize) {
        pageSize = nextPageSize;
        continue;
      }
    }

    if (!response.ok) {
      throw new Error(`Jira search failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as JiraSearchResponse;
    return {
      ...payload,
      runtime: activeRuntime,
    };
  }
}
