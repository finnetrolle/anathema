import { describe, it, expect } from "vitest";
import {
  readRawPayload,
  toRecord,
  readNumericValue,
  parseDerivedDate,
  buildIssueUrl,
  splitComponentNames,
  deriveAuthorName,
  deriveStatusCategoryKey,
  deriveEstimateHours,
  deriveEstimateStoryPoints,
  deriveAssigneeHistory,
  deriveObservedPeople,
  deriveComponentName,
} from "./raw-payload-helpers";
import type { RawPayloadIssue } from "./raw-payload-helpers";

// ── readRawPayload ──

describe("readRawPayload", () => {
  it("returns object as RawPayloadIssue", () => {
    const obj = { fields: { summary: "test" } };
    expect(readRawPayload(obj as any)).toBe(obj);
  });

  it("returns null for null", () => {
    expect(readRawPayload(null)).toBeNull();
  });

  it("returns null for array", () => {
    expect(readRawPayload([1, 2, 3] as any)).toBeNull();
  });

  it("returns null for string", () => {
    expect(readRawPayload("hello" as any)).toBeNull();
  });

  it("returns null for number", () => {
    expect(readRawPayload(42 as any)).toBeNull();
  });
});

// ── toRecord ──

describe("toRecord", () => {
  it("returns object as record", () => {
    const obj = { a: 1 };
    expect(toRecord(obj)).toBe(obj);
  });

  it("returns null for array", () => {
    expect(toRecord([1, 2, 3])).toBeNull();
  });

  it("returns null for null", () => {
    expect(toRecord(null)).toBeNull();
  });

  it("returns null for string", () => {
    expect(toRecord("hello")).toBeNull();
  });
});

// ── readNumericValue ──

describe("readNumericValue", () => {
  it("returns finite number as-is", () => {
    expect(readNumericValue(42)).toBe(42);
    expect(readNumericValue(3.5)).toBe(3.5);
    expect(readNumericValue(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(readNumericValue("3.5")).toBe(3.5);
    expect(readNumericValue("  42  ")).toBe(42);
  });

  it("returns null for NaN number", () => {
    expect(readNumericValue(Number.NaN)).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(readNumericValue("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(readNumericValue("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(readNumericValue(null)).toBeNull();
    expect(readNumericValue(undefined)).toBeNull();
  });
});

// ── parseDerivedDate ──

describe("parseDerivedDate", () => {
  it("parses ISO date string", () => {
    const result = parseDerivedDate("2026-04-28T12:00:00.000Z");
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-04-28T12:00:00.000Z");
  });

  it("returns null for null", () => {
    expect(parseDerivedDate(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseDerivedDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDerivedDate("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseDerivedDate("not-a-date")).toBeNull();
  });
});

// ── buildIssueUrl ──

describe("buildIssueUrl", () => {
  it("builds URL from base and key", () => {
    expect(buildIssueUrl("https://jira.example.com", "PROJ-1")).toBe(
      "https://jira.example.com/browse/PROJ-1",
    );
  });

  it("strips trailing slash from base URL", () => {
    expect(buildIssueUrl("https://jira.example.com/", "PROJ-1")).toBe(
      "https://jira.example.com/browse/PROJ-1",
    );
  });

  it("returns null for null baseUrl", () => {
    expect(buildIssueUrl(null, "PROJ-1")).toBeNull();
  });

  it("returns null for undefined baseUrl", () => {
    expect(buildIssueUrl(undefined, "PROJ-1")).toBeNull();
  });

  it("returns null for empty baseUrl", () => {
    expect(buildIssueUrl("", "PROJ-1")).toBeNull();
  });
});

// ── splitComponentNames ──

describe("splitComponentNames", () => {
  it("splits comma-separated names", () => {
    expect(splitComponentNames("A, B, C")).toEqual(["A", "B", "C"]);
  });

  it("returns single element for one name", () => {
    expect(splitComponentNames("Backend")).toEqual(["Backend"]);
  });

  it("filters empty parts", () => {
    expect(splitComponentNames("A, , B")).toEqual(["A", "B"]);
  });

  it("returns empty array for empty string", () => {
    expect(splitComponentNames("")).toEqual([]);
  });

  it("trims whitespace", () => {
    expect(splitComponentNames("  A  ,  B  ")).toEqual(["A", "B"]);
  });
});

// ── deriveAuthorName ──

describe("deriveAuthorName", () => {
  it("returns creator displayName", () => {
    const payload = {
      fields: {
        creator: { displayName: "Alice" },
        reporter: { displayName: "Bob" },
      },
    };
    expect(deriveAuthorName(payload as any)).toBe("Alice");
  });

  it("falls back to reporter when no creator", () => {
    const payload = {
      fields: {
        reporter: { displayName: "Bob" },
      },
    };
    expect(deriveAuthorName(payload as any)).toBe("Bob");
  });

  it("returns null when neither exists", () => {
    expect(deriveAuthorName({ fields: {} } as any)).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(deriveAuthorName(null)).toBeNull();
  });

  it("trims whitespace from name", () => {
    const payload = {
      fields: {
        creator: { displayName: "  Alice  " },
      },
    };
    expect(deriveAuthorName(payload as any)).toBe("Alice");
  });
});

// ── deriveStatusCategoryKey ──

describe("deriveStatusCategoryKey", () => {
  it("returns status category key", () => {
    const payload = {
      fields: {
        status: {
          statusCategory: { key: "in_progress" },
        },
      },
    };
    expect(deriveStatusCategoryKey(payload as any)).toBe("in_progress");
  });

  it("returns null for missing statusCategory", () => {
    const payload = { fields: { status: {} } };
    expect(deriveStatusCategoryKey(payload as any)).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(deriveStatusCategoryKey(null)).toBeNull();
  });

  it("returns null for empty fields", () => {
    expect(deriveStatusCategoryKey({ fields: {} } as any)).toBeNull();
  });
});

// ── deriveEstimateHours ──

describe("deriveEstimateHours", () => {
  it("converts timeoriginalestimate seconds to hours", () => {
    const payload = {
      fields: { timeoriginalestimate: 3600 },
    };
    expect(deriveEstimateHours(payload as any)).toBe(1);
  });

  it("falls back to aggregatetimeoriginalestimate", () => {
    const payload = {
      fields: { aggregatetimeoriginalestimate: 7200 },
    };
    expect(deriveEstimateHours(payload as any)).toBe(2);
  });

  it("returns null when neither estimate exists", () => {
    expect(deriveEstimateHours({ fields: {} } as any)).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(deriveEstimateHours(null)).toBeNull();
  });

  it("handles string estimate values", () => {
    const payload = {
      fields: { timeoriginalestimate: "3600" },
    };
    expect(deriveEstimateHours(payload as any)).toBe(1);
  });
});

// ── deriveEstimateStoryPoints ──

describe("deriveEstimateStoryPoints", () => {
  it("reads value from configured storyPointFieldIds", () => {
    const payload = {
      fields: { customfield_10002: 5 },
      __anathemaMeta: { storyPointFieldIds: ["customfield_10002"] },
    };
    expect(deriveEstimateStoryPoints(payload as any)).toBe(5);
  });

  it("returns first matching field value", () => {
    const payload = {
      fields: { customfield_10001: null, customfield_10002: 8 },
      __anathemaMeta: { storyPointFieldIds: ["customfield_10001", "customfield_10002"] },
    };
    expect(deriveEstimateStoryPoints(payload as any)).toBe(8);
  });

  it("returns null when no configured fieldIds", () => {
    const payload = {
      fields: {},
      __anathemaMeta: { storyPointFieldIds: [] },
    };
    expect(deriveEstimateStoryPoints(payload as any)).toBeNull();
  });

  it("returns null for null payload", () => {
    expect(deriveEstimateStoryPoints(null)).toBeNull();
  });

  it("returns null when field value is not numeric", () => {
    const payload = {
      fields: { customfield_10002: "abc" },
      __anathemaMeta: { storyPointFieldIds: ["customfield_10002"] },
    };
    expect(deriveEstimateStoryPoints(payload as any)).toBeNull();
  });
});

// ── deriveAssigneeHistory ──

describe("deriveAssigneeHistory", () => {
  it("extracts unique assignee names from changelog in order", () => {
    const payload = {
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }],
          },
          {
            created: "2026-01-02",
            items: [{ field: "assignee", fromString: "Bob", toString: "Charlie" }],
          },
        ],
      },
    };
    const result = deriveAssigneeHistory(payload as any);
    expect(result).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("filters out Unassigned values", () => {
    const payload = {
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "assignee", fromString: "Unassigned", toString: "Alice" }],
          },
        ],
      },
    };
    const result = deriveAssigneeHistory(payload as any);
    expect(result).toEqual(["Alice"]);
  });

  it("filters duplicates", () => {
    const payload = {
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }],
          },
          {
            created: "2026-01-02",
            items: [{ field: "assignee", fromString: "Bob", toString: "Alice" }],
          },
        ],
      },
    };
    const result = deriveAssigneeHistory(payload as any);
    expect(result).toEqual(["Alice", "Bob"]);
  });

  it("includes current assignee at the end", () => {
    const payload = {
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }],
          },
        ],
      },
    };
    const result = deriveAssigneeHistory(payload as any, "Dave");
    expect(result).toEqual(["Alice", "Bob", "Dave"]);
  });

  it("ignores non-assignee field changes", () => {
    const payload = {
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "status", fromString: "Open", toString: "Closed" }],
          },
        ],
      },
    };
    const result = deriveAssigneeHistory(payload as any);
    expect(result).toEqual([]);
  });

  it("returns empty array for null payload", () => {
    expect(deriveAssigneeHistory(null)).toEqual([]);
  });
});

// ── deriveObservedPeople ──

describe("deriveObservedPeople", () => {
  it("combines assignee history, current assignee, creator, and reporter", () => {
    const payload = {
      fields: {
        creator: { displayName: "Creator" },
        reporter: { displayName: "Reporter" },
      },
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "assignee", fromString: "Alice", toString: "Bob" }],
          },
        ],
      },
    };
    const result = deriveObservedPeople(payload as any, "Current");
    expect(result).toEqual(["Alice", "Bob", "Current", "Creator", "Reporter"]);
  });

  it("deduplicates people", () => {
    const payload = {
      fields: {
        creator: { displayName: "Alice" },
        reporter: { displayName: "Alice" },
      },
      changelog: {
        histories: [],
      },
    };
    const result = deriveObservedPeople(payload as any, "Alice");
    expect(result).toEqual(["Alice"]);
  });

  it("returns empty array for null payload", () => {
    expect(deriveObservedPeople(null)).toEqual([]);
  });

  it("handles missing fields gracefully", () => {
    expect(deriveObservedPeople({ fields: {} } as any)).toEqual([]);
  });
});

// ── deriveComponentName ──

describe("deriveComponentName", () => {
  it("returns joined component names from fields", () => {
    const payload = {
      fields: {
        components: [{ name: "Backend" }, { name: "API" }],
      },
    };
    expect(deriveComponentName(payload as any, "en")).toBe("Backend, API");
  });

  it("returns single component name", () => {
    const payload = {
      fields: {
        components: [{ name: "Backend" }],
      },
    };
    expect(deriveComponentName(payload as any, "en")).toBe("Backend");
  });

  it("falls back to changelog Component history", () => {
    const payload = {
      fields: { components: [] },
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "Component", toString: "Backend" }],
          },
        ],
      },
    };
    expect(deriveComponentName(payload as any, "en")).toBe("Backend");
  });

  it("uses latest changelog entry for component", () => {
    const payload = {
      fields: { components: [] },
      changelog: {
        histories: [
          {
            created: "2026-01-01",
            items: [{ field: "Component", toString: "Old" }],
          },
          {
            created: "2026-01-02",
            items: [{ field: "Component", toString: "New" }],
          },
        ],
      },
    };
    expect(deriveComponentName(payload as any, "en")).toBe("New");
  });

  it('returns "No component" for empty payload with en locale', () => {
    expect(deriveComponentName(null, "en")).toBe("No component");
  });

  it('returns "Без компонента" by default (ru locale)', () => {
    expect(deriveComponentName(null)).toBe("Без компонента");
  });

  it('returns placeholder when no components anywhere', () => {
    const payload = { fields: { components: [] } };
    expect(deriveComponentName(payload as any, "en")).toBe("No component");
  });

  it("returns Russian placeholder for ru locale", () => {
    expect(deriveComponentName(null, "ru")).toBe("Без компонента");
  });
});
