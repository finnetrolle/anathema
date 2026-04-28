import { describe, it, expect } from "vitest";
import {
  readEpicLinkKey,
  parseJiraDate,
  toPrismaJson,
  buildRawPayload,
  toPrismaMarkerKind,
  isEpicIssue,
  buildProjectSeed,
  buildEpicSeed,
  buildEpicLookup,
  buildLinkedEpicSeed,
  isPlaceholderEpicId,
  isPlaceholderEpicSummary,
  mergeEpicSeeds,
  collectEntities,
} from "./sync-entities";
import type { JiraIssue } from "./types";

// ── Minimal JiraIssue fixtures ──

function makeIssue(overrides: Partial<JiraIssue> & { id: string; key: string }): JiraIssue {
  return {
    id: overrides.id,
    key: overrides.key,
    fields: {
      summary: overrides.fields?.summary ?? "Test",
      issuetype: overrides.fields?.issuetype ?? { name: "Task" },
      status: overrides.fields?.status ?? { name: "To Do" },
      project: overrides.fields?.project ?? { id: "proj1", key: "PROJ", name: "Project" },
      created: overrides.fields?.created ?? "2026-01-01T00:00:00.000Z",
      updated: overrides.fields?.updated ?? "2026-01-02T00:00:00.000Z",
      ...overrides.fields,
    },
    changelog: overrides.changelog,
  } as JiraIssue;
}

const epicIssue = makeIssue({
  id: "epic1",
  key: "PROJ-1",
  fields: {
    summary: "My Epic",
    issuetype: { name: "Epic" },
    status: { name: "In Progress" },
    updated: "2026-03-01T00:00:00.000Z",
  },
});

const taskIssue = makeIssue({
  id: "task1",
  key: "PROJ-2",
  fields: {
    summary: "My Task",
    issuetype: { name: "Task" },
    status: { name: "To Do" },
    assignee: {
      accountId: "user1",
      displayName: "Alice",
      emailAddress: "alice@test.com",
    },
    created: "2026-01-10T00:00:00.000Z",
    updated: "2026-01-15T00:00:00.000Z",
    duedate: "2026-02-01",
  },
  changelog: {
    histories: [
      {
        created: "2026-01-12T00:00:00.000Z",
        items: [
          { field: "status", fromString: "To Do", toString: "In Progress" },
        ],
      },
    ],
  },
});

const taskWithParent = makeIssue({
  id: "task2",
  key: "PROJ-3",
  fields: {
    summary: "Child Task",
    parent: { id: "parent1", key: "PROJ-1" },
  },
});

// ── readEpicLinkKey ──

describe("readEpicLinkKey", () => {
  const makeWithField = (fieldId: string, value: unknown) =>
    makeIssue({
      id: "x",
      key: "X-1",
      fields: { [fieldId]: value } as Partial<JiraIssue["fields"]>,
    });

  it("returns string value from field", () => {
    expect(readEpicLinkKey(makeWithField("customfield_1", "PROJ-1"), "customfield_1")).toBe("PROJ-1");
  });

  it("extracts .key from object value", () => {
    expect(readEpicLinkKey(makeWithField("cf", { key: "PROJ-2" }), "cf")).toBe("PROJ-2");
  });

  it("returns null when no fieldId provided", () => {
    expect(readEpicLinkKey(makeIssue({ id: "x", key: "X-1" }), undefined)).toBeNull();
  });

  it("returns null for unrecognized value type", () => {
    expect(readEpicLinkKey(makeWithField("cf", 42), "cf")).toBeNull();
  });
});

// ── parseJiraDate ──

describe("parseJiraDate", () => {
  it("parses ISO datetime", () => {
    const d = parseJiraDate("2026-04-28T12:00:00.000Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toContain("2026-04-28");
  });

  it("parses date-only string with timezone", () => {
    const d = parseJiraDate("2026-04-28", "Europe/Moscow");
    expect(d).toBeInstanceOf(Date);
  });

  it("returns null for null/undefined", () => {
    expect(parseJiraDate(null)).toBeNull();
    expect(parseJiraDate(undefined)).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(parseJiraDate("not-a-date")).toBeNull();
  });
});

// ── toPrismaJson ──

describe("toPrismaJson", () => {
  it("round-trips an object", () => {
    const obj = { a: 1, b: "hello" };
    expect(toPrismaJson(obj)).toEqual(obj);
  });
});

// ── buildRawPayload ──

describe("buildRawPayload", () => {
  it("includes __anathemaMeta with field IDs", () => {
    const payload = buildRawPayload(epicIssue, ["cf_sp"], ["cf_dev"]);
    expect(payload.__anathemaMeta).toEqual({
      storyPointFieldIds: ["cf_sp"],
      developmentFieldIds: ["cf_dev"],
    });
  });

  it("defaults to empty arrays when no field IDs", () => {
    const payload = buildRawPayload(epicIssue);
    expect(payload.__anathemaMeta).toEqual({
      storyPointFieldIds: [],
      developmentFieldIds: [],
    });
  });
});

// ── toPrismaMarkerKind ──

describe("toPrismaMarkerKind", () => {
  it("maps DONE", () => {
    expect(toPrismaMarkerKind("DONE")).toBe("DONE");
  });

  it("maps DUE", () => {
    expect(toPrismaMarkerKind("DUE")).toBe("DUE");
  });

  it("maps NONE as default", () => {
    expect(toPrismaMarkerKind("NONE")).toBe("NONE");
  });
});

// ── isEpicIssue ──

describe("isEpicIssue", () => {
  it("returns true for Epic issuetype", () => {
    expect(isEpicIssue(epicIssue)).toBe(true);
  });

  it("returns false for Task", () => {
    expect(isEpicIssue(taskIssue)).toBe(false);
  });
});

// ── buildProjectSeed ──

describe("buildProjectSeed", () => {
  it("extracts project fields", () => {
    const seed = buildProjectSeed(taskIssue);
    expect(seed).toEqual({
      jiraProjectId: "proj1",
      key: "PROJ",
      name: "Project",
    });
  });

  it("falls back to key prefix without project", () => {
    const issue = makeIssue({
      id: "x",
      key: "ABC-1",
      fields: { project: undefined } as unknown as Partial<JiraIssue["fields"]>,
    });
    const seed = buildProjectSeed(issue);
    expect(seed.key).toBe("ABC");
    expect(seed.jiraProjectId).toBe("ABC");
  });
});

// ── buildEpicSeed ──

describe("buildEpicSeed", () => {
  it("returns seed for epic issue", () => {
    const seed = buildEpicSeed(epicIssue);
    expect(seed).not.toBeNull();
    expect(seed!.key).toBe("PROJ-1");
    expect(seed!.jiraEpicId).toBe("epic1");
  });

  it("returns seed for task with parent", () => {
    const seed = buildEpicSeed(taskWithParent);
    expect(seed).not.toBeNull();
    expect(seed!.jiraEpicId).toBe("parent1");
    expect(seed!.key).toBe("PROJ-1");
  });

  it("returns null for task without parent", () => {
    const seed = buildEpicSeed(taskIssue);
    expect(seed).toBeNull();
  });
});

// ── buildEpicLookup ──

describe("buildEpicLookup", () => {
  it("maps epic issues by id and key", () => {
    const lookup = buildEpicLookup([epicIssue, taskIssue]);
    expect(lookup.has("epic1")).toBe(true);
    expect(lookup.has("PROJ-1")).toBe(true);
    expect(lookup.has("task1")).toBe(false);
    expect(lookup.size).toBe(2);
  });
});

// ── buildLinkedEpicSeed ──

describe("buildLinkedEpicSeed", () => {
  it("returns null when no epicLinkFieldId", () => {
    const result = buildLinkedEpicSeed({
      issue: taskIssue,
      epicLookup: new Map(),
    });
    expect(result).toBeNull();
  });

  it("resolves epic from lookup via field value", () => {
    const issue = makeIssue({
      id: "t",
      key: "PROJ-5",
      fields: { customfield_10000: "PROJ-1" } as Partial<JiraIssue["fields"]>,
    });
    const lookup = buildEpicLookup([epicIssue]);
    const result = buildLinkedEpicSeed({
      issue,
      epicLookup: lookup,
      epicLinkFieldId: "customfield_10000",
    });
    expect(result).not.toBeNull();
    expect(result!.jiraEpicId).toBe("epic1");
  });

  it("creates placeholder seed when epic not in lookup", () => {
    const issue = makeIssue({
      id: "t",
      key: "PROJ-5",
      fields: { customfield_10000: "MISSING-1" } as Partial<JiraIssue["fields"]>,
    });
    const result = buildLinkedEpicSeed({
      issue,
      epicLookup: new Map(),
      epicLinkFieldId: "customfield_10000",
    });
    expect(result).not.toBeNull();
    expect(result!.jiraEpicId).toBe("MISSING-1");
    expect(result!.summary).toBe("MISSING-1");
  });
});

// ── isPlaceholderEpicId / isPlaceholderEpicSummary ──

describe("isPlaceholderEpicId", () => {
  it("returns true when id equals key", () => {
    expect(isPlaceholderEpicId("PROJ-1", "PROJ-1")).toBe(true);
  });
  it("returns false when different", () => {
    expect(isPlaceholderEpicId("12345", "PROJ-1")).toBe(false);
  });
});

describe("isPlaceholderEpicSummary", () => {
  it("returns true when summary equals key", () => {
    expect(isPlaceholderEpicSummary("PROJ-1", "PROJ-1")).toBe(true);
  });
  it("returns true when summary is empty", () => {
    expect(isPlaceholderEpicSummary("  ", "KEY")).toBe(true);
  });
  it("returns false for real summary", () => {
    expect(isPlaceholderEpicSummary("My Epic", "PROJ-1")).toBe(false);
  });
});

// ── mergeEpicSeeds ──

describe("mergeEpicSeeds", () => {
  it("replaces placeholder id with real id", () => {
    const existing: EpicSeed = {
      jiraEpicId: "PROJ-1",
      key: "PROJ-1",
      summary: "Real Summary",
      status: "In Progress",
      jiraUpdatedAt: null,
    };
    const incoming: EpicSeed = {
      jiraEpicId: "real-id-1",
      key: "PROJ-1",
      summary: "PROJ-1",
      status: "Unknown",
      jiraUpdatedAt: new Date("2026-03-01"),
    };
    const merged = mergeEpicSeeds(existing, incoming);
    expect(merged.jiraEpicId).toBe("real-id-1");
    expect(merged.summary).toBe("Real Summary");
    expect(merged.status).toBe("In Progress");
  });

  it("keeps existing non-placeholder id", () => {
    const existing: EpicSeed = {
      jiraEpicId: "real-1",
      key: "PROJ-1",
      summary: "Real Summary",
      status: "In Progress",
      jiraUpdatedAt: null,
    };
    const incoming: EpicSeed = {
      jiraEpicId: "PROJ-1",
      key: "PROJ-1",
      summary: "Better Summary",
      status: "Done",
      jiraUpdatedAt: new Date("2026-04-01"),
    };
    const merged = mergeEpicSeeds(existing, incoming);
    expect(merged.jiraEpicId).toBe("real-1");
    expect(merged.summary).toBe("Better Summary");
  });
});

// ── collectEntities ──

describe("collectEntities", () => {
  it("collects projects, assignees, epics, issues, and transitions from mixed issues", () => {
    const result = collectEntities(
      [epicIssue, taskIssue],
      "sync-run-1",
      "UTC",
      { startStatuses: ["In Progress"], endStatuses: ["Done"], inProgressStatusSet: new Set(["in progress"]), doneStatusSet: new Set(["done"]), usesFallback: false },
    );

    // Projects
    expect(result.projectMap.size).toBe(1);
    expect(result.projectMap.get("proj1")).toBeDefined();

    // Assignees
    expect(result.assigneeMap.size).toBe(1);
    expect(result.assigneeMap.get("accountId:user1")).toBeDefined();

    // Epics
    expect(result.epicMap.size).toBe(1);
    expect(result.epicMap.get("PROJ-1")).toBeDefined();

    // Issues
    expect(result.issueRecords).toHaveLength(2);
    expect(result.issueRecords[0].jiraIssueId).toBe("epic1");
    expect(result.issueRecords[1].jiraIssueId).toBe("task1");
    expect(result.issueRecords[1].isEpic).toBe(false);

    // Transitions
    expect(result.transitionRecords).toHaveLength(1);
    expect(result.transitionRecords[0].toStatus).toBe("In Progress");
  });

  it("handles empty issues array", () => {
    const result = collectEntities([], "sync-1", "UTC", { startStatuses: [], endStatuses: [], inProgressStatusSet: new Set(), doneStatusSet: new Set(), usesFallback: false });
    expect(result.projectMap.size).toBe(0);
    expect(result.issueRecords).toHaveLength(0);
    expect(result.transitionRecords).toHaveLength(0);
  });
});
