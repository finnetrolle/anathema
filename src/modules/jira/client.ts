import type {
  JiraFieldDefinition,
  JiraIssue,
  JiraSearchResponse,
} from "@/modules/jira/types";
import { readJsonResponse } from "@/modules/http/read-json-response";
import { isAbortError, throwIfAborted } from "@/modules/jira/abort";

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

function isAtlassianCloudUrl(baseUrl: string) {
  return new URL(baseUrl).hostname.endsWith("atlassian.net");
}

function buildJiraApiUrl(
  baseUrl: string,
  path: string,
  options?: {
    authMode?: JiraAuthMode;
    apiVersion?: JiraApiVersion;
    query?: Record<string, string | number | boolean | undefined>;
  },
) {
  const resolvedPath = options?.apiVersion
    ? path.replace("{apiVersion}", options.apiVersion)
    : path;
  const url = new URL(`${trimTrailingSlash(baseUrl)}${resolvedPath}`);

  if (options?.authMode === "basic" && !isAtlassianCloudUrl(baseUrl)) {
    url.searchParams.set("os_authType", "basic");
  }

  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function fetchJson<T>(
  input: string,
  init: RequestInit,
  options: {
    context: string;
    htmlHint?: string;
  },
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
    data: await readJsonResponse<T>(response, options),
  };
}

async function fetchFieldDefinitions(
  runtime: JiraRuntimeConfig,
  signal?: AbortSignal,
) {
  const response = await fetchJson<JiraFieldDefinition[]>(
    buildJiraApiUrl(runtime.baseUrl, "/rest/api/{apiVersion}/field", {
      authMode: runtime.authMode,
      apiVersion: runtime.apiVersion,
    }),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: runtime.authHeader,
      },
      cache: "no-store",
      signal,
    },
    {
      context: "Jira field definitions endpoint",
      htmlHint:
        "Check JIRA_BASE_URL, authentication settings, and whether Jira redirected to a login page.",
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
  let lastResolutionError: Error | null = null;

  for (const baseUrl of baseUrlCandidates) {
    for (const authMode of authModes) {
      throwIfAborted(signal);
      const authHeader = createAuthHeader(
        authMode,
        credentials.email,
        credentials.apiToken,
      );

      for (const apiVersion of apiVersions) {
        let response: Awaited<
          ReturnType<typeof fetchJson<Record<string, unknown>>>
        >;

        try {
          response = await fetchJson<Record<string, unknown>>(
            buildJiraApiUrl(baseUrl, "/rest/api/{apiVersion}/serverInfo", {
              authMode,
              apiVersion,
            }),
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: authHeader,
              },
              cache: "no-store",
              signal,
            },
            {
              context: "Jira server info endpoint",
              htmlHint:
                "Check JIRA_BASE_URL, authentication settings, and whether Jira redirected to a login page.",
            },
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }

          lastResolutionError =
            error instanceof Error ? error : new Error(String(error));
          continue;
        }

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

  if (lastResolutionError) {
    throw lastResolutionError;
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
      buildJiraApiUrl(activeRuntime.baseUrl, "/rest/api/{apiVersion}/search", {
        authMode: activeRuntime.authMode,
        apiVersion: activeRuntime.apiVersion,
      }),
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

    const payload = await readJsonResponse<JiraSearchResponse>(response, {
      context: "Jira search endpoint",
      htmlHint:
        "Check JIRA_BASE_URL, authentication settings, and whether Jira redirected to a login page.",
    });
    return {
      ...payload,
      runtime: activeRuntime,
    };
  }
}
