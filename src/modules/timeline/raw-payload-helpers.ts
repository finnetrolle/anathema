import type { Prisma } from "@prisma/client";

import { DEFAULT_APP_LOCALE, type AppLocale } from "@/modules/i18n/config";

export type RawPayloadUser = {
  displayName?: string | null;
};

export type RawPayloadIssue = {
  fields?: {
    components?: Array<{
      name?: string | null;
    }> | null;
    creator?: RawPayloadUser | null;
    reporter?: RawPayloadUser | null;
    assignee?: RawPayloadUser | null;
    status?: {
      statusCategory?: {
        key?: string | null;
      } | null;
    } | null;
    timeoriginalestimate?: number | string | null;
    aggregatetimeoriginalestimate?: number | string | null;
  } & Record<string, unknown>;
  changelog?: {
    histories?: Array<{
      id?: string;
      created?: string;
      items?: Array<{
        field?: string;
        fromString?: string | null;
        toString?: string | null;
      }>;
    }> | null;
  };
  __anathemaMeta?: {
    storyPointFieldIds?: string[] | null;
    developmentFieldIds?: string[] | null;
  };
};

export function getTimelinePlaceholderCopy(locale: AppLocale) {
  return {
    noComponent: locale === "ru" ? "Без компонента" : "No component",
    unassigned: locale === "ru" ? "Не назначен" : "Unassigned",
    ungroupedWork: locale === "ru" ? "Работа без эпика" : "Ungrouped work",
  };
}

export function buildIssueUrl(baseUrl: string | null | undefined, key: string) {
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

export function splitComponentNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readRawPayload(rawPayload: Prisma.JsonValue | null) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  return rawPayload as RawPayloadIssue;
}

export function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function readNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parseDerivedDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveAuthorName(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return (
    payload?.fields?.creator?.displayName?.trim() ||
    payload?.fields?.reporter?.displayName?.trim() ||
    null
  );
}

export function deriveStatusCategoryKey(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);

  return payload?.fields?.status?.statusCategory?.key ?? null;
}

function sortChangelogHistories(payload: RawPayloadIssue | null) {
  return [...(payload?.changelog?.histories ?? [])].sort((left, right) =>
    (left.created ?? "").localeCompare(right.created ?? ""),
  );
}

export function deriveEstimateHours(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const estimateInSeconds =
    readNumericValue(payload?.fields?.timeoriginalestimate) ??
    readNumericValue(payload?.fields?.aggregatetimeoriginalestimate);

  return estimateInSeconds === null ? null : estimateInSeconds / 3600;
}

export function deriveEstimateStoryPoints(rawPayload: Prisma.JsonValue | null) {
  const payload = readRawPayload(rawPayload);
  const storyPointFieldIds = payload?.__anathemaMeta?.storyPointFieldIds ?? [];

  for (const fieldId of storyPointFieldIds) {
    const storyPoints = readNumericValue(payload?.fields?.[fieldId]);

    if (storyPoints !== null) {
      return storyPoints;
    }
  }

  return null;
}

export function deriveAssigneeHistory(
  rawPayload: Prisma.JsonValue | null,
  currentAssigneeName?: string | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const copy = getTimelinePlaceholderCopy(locale);
  const payload = readRawPayload(rawPayload);
  const assigneeNames: string[] = [];
  const seenNames = new Set<string>();

  const addAssignee = (value?: string | null) => {
    const normalized = value?.trim();

    if (
      !normalized ||
      normalized === "Unassigned" ||
      normalized === "Не назначен" ||
      normalized === copy.unassigned ||
      seenNames.has(normalized)
    ) {
      return;
    }

    seenNames.add(normalized);
    assigneeNames.push(normalized);
  };

  for (const history of sortChangelogHistories(payload)) {
    for (const item of history.items ?? []) {
      if (item.field?.toLowerCase() !== "assignee") {
        continue;
      }

      addAssignee(item.fromString);
      addAssignee(item.toString);
    }
  }

  addAssignee(currentAssigneeName);

  return assigneeNames;
}

export function deriveObservedPeople(
  rawPayload: Prisma.JsonValue | null,
  currentAssigneeName?: string | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const payload = readRawPayload(rawPayload);
  const observedPeople: string[] = [];
  const seenPeople = new Set<string>();

  const addPerson = (value?: string | null) => {
    const normalized = value?.trim();

    if (!normalized || seenPeople.has(normalized)) {
      return;
    }

    seenPeople.add(normalized);
    observedPeople.push(normalized);
  };

  for (const assigneeName of deriveAssigneeHistory(
    rawPayload,
    currentAssigneeName,
    locale,
  )) {
    addPerson(assigneeName);
  }

  addPerson(currentAssigneeName);
  addPerson(payload?.fields?.creator?.displayName);
  addPerson(payload?.fields?.reporter?.displayName);

  return observedPeople;
}

export function deriveComponentName(
  rawPayload: Prisma.JsonValue | null,
  locale: AppLocale = DEFAULT_APP_LOCALE,
) {
  const copy = getTimelinePlaceholderCopy(locale);
  const payload = readRawPayload(rawPayload);

  if (!payload) {
    return copy.noComponent;
  }

  const fieldComponents =
    payload.fields?.components
      ?.map((component) => component.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? [];

  if (fieldComponents.length > 0) {
    return fieldComponents.join(", ");
  }

  const componentHistories =
    payload.changelog?.histories
      ?.filter((history) =>
        history.items?.some(
          (item) => item.field === "Component" || item.field === "components",
        ),
      )
      .sort((left, right) => (left.created ?? "").localeCompare(right.created ?? "")) ?? [];

  const latestHistory = componentHistories.at(-1);
  const latestComponentValue = latestHistory?.items
    ?.filter((item) => item.field === "Component" || item.field === "components")
    .map((item) => item.toString?.trim() ?? "")
    .find((value) => value.length > 0);

  if (latestComponentValue) {
    const names = splitComponentNames(latestComponentValue);

    return names.length > 0 ? names.join(", ") : copy.noComponent;
  }

  return copy.noComponent;
}
