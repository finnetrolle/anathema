import { describe, it, expect } from "vitest";
import {
  extractEmbeddedJsonValue,
  parseJsonValue,
  readCountLike,
  normalizePullRequestStatus,
  derivePullRequestStatusFromCounters,
  derivePullRequestCount,
  mergePullRequestStatus,
  hasDevelopmentSummary,
  mergeDevelopmentSummaries,
  readSummaryNode,
  readTargetsSummary,
  looksLikeDevelopmentFieldValue,
  readDevelopmentFieldValue,
  deriveDevelopmentSummary,
  EMPTY_DEVELOPMENT_SUMMARY,
} from "./development-summary";
import type { DerivedDevelopmentSummary } from "./development-summary";

// ── extractEmbeddedJsonValue ──

describe("extractEmbeddedJsonValue", () => {
  it("returns null when no devSummaryJson= marker", () => {
    expect(extractEmbeddedJsonValue('{"foo":"bar"}')).toBeNull();
  });

  it("returns null when no { after marker", () => {
    expect(extractEmbeddedJsonValue("devSummaryJson=notjson")).toBeNull();
  });

  it("extracts balanced JSON object", () => {
    const input = 'devSummaryJson={"count":3}';
    expect(extractEmbeddedJsonValue(input)).toBe('{"count":3}');
  });

  it("handles nested objects", () => {
    const inner = '{"outer":{"inner":1}}';
    const input = `prefix devSummaryJson=${inner} suffix`;
    expect(extractEmbeddedJsonValue(input)).toBe(inner);
  });

  it("handles strings with escaped quotes inside JSON", () => {
    const inner = '{"msg":"he said \\"hello\\""}';
    const input = `devSummaryJson=${inner}`;
    expect(extractEmbeddedJsonValue(input)).toBe(inner);
  });
});

// ── parseJsonValue ──

describe("parseJsonValue", () => {
  it("parses valid JSON string", () => {
    expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 });
  });

  it("falls back to embedded JSON for string with marker", () => {
    const result = parseJsonValue('cachedValue;devSummaryJson={"b":2}');
    expect(result).toEqual({ b: 2 });
  });

  it("returns null for invalid JSON without embedded marker", () => {
    expect(parseJsonValue("not-json")).toBeNull();
  });
});

// ── readCountLike ──

describe("readCountLike", () => {
  it("returns number as-is", () => {
    expect(readCountLike(5)).toBe(5);
  });

  it("parses numeric strings", () => {
    expect(readCountLike("3")).toBe(3);
  });

  it("returns length for arrays", () => {
    expect(readCountLike([1, 2, 3])).toBe(3);
  });

  it("returns null for non-numeric strings", () => {
    expect(readCountLike("abc")).toBeNull();
  });

  it("returns null for objects", () => {
    expect(readCountLike({})).toBeNull();
  });

  it("returns null for null", () => {
    expect(readCountLike(null)).toBeNull();
  });
});

// ── normalizePullRequestStatus ──

describe("normalizePullRequestStatus", () => {
  it("normalizes OPEN case-insensitively", () => {
    expect(normalizePullRequestStatus("open")).toBe("OPEN");
    expect(normalizePullRequestStatus("Open")).toBe("OPEN");
  });

  it("normalizes MERGED", () => {
    expect(normalizePullRequestStatus("MERGED")).toBe("MERGED");
  });

  it("normalizes DECLINED", () => {
    expect(normalizePullRequestStatus("declined")).toBe("DECLINED");
  });

  it("returns null for non-strings", () => {
    expect(normalizePullRequestStatus(42)).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizePullRequestStatus("pending")).toBeNull();
  });
});

// ── derivePullRequestStatusFromCounters ──

describe("derivePullRequestStatusFromCounters", () => {
  it("returns OPEN when open > 0", () => {
    expect(derivePullRequestStatusFromCounters({ open: 1, merged: 0 })).toBe("OPEN");
  });

  it("returns MERGED when merged > 0 and open is 0", () => {
    expect(derivePullRequestStatusFromCounters({ merged: 2 })).toBe("MERGED");
  });

  it("returns DECLINED when declined > 0 and others are 0", () => {
    expect(derivePullRequestStatusFromCounters({ declined: 1 })).toBe("DECLINED");
  });

  it("returns NONE when all are 0", () => {
    expect(derivePullRequestStatusFromCounters({})).toBe("NONE");
  });
});

// ── derivePullRequestCount ──

describe("derivePullRequestCount", () => {
  it("reads count field", () => {
    expect(derivePullRequestCount({ count: 5 })).toBe(5);
  });

  it("reads total field as fallback", () => {
    expect(derivePullRequestCount({ total: 3 })).toBe(3);
  });

  it("reads details.total as fallback", () => {
    expect(derivePullRequestCount({ details: { total: 2 } })).toBe(2);
  });

  it("falls back to sum of open+merged+declined", () => {
    expect(derivePullRequestCount({ open: 1, merged: 2, declined: 1 })).toBe(4);
  });
});

// ── mergePullRequestStatus ──

describe("mergePullRequestStatus", () => {
  it("OPEN wins over everything", () => {
    expect(mergePullRequestStatus("OPEN", "MERGED")).toBe("OPEN");
    expect(mergePullRequestStatus("MERGED", "OPEN")).toBe("OPEN");
  });

  it("MERGED wins over DECLINED/NONE", () => {
    expect(mergePullRequestStatus("MERGED", "DECLINED")).toBe("MERGED");
    expect(mergePullRequestStatus("NONE", "MERGED")).toBe("MERGED");
  });

  it("DECLINED wins over NONE", () => {
    expect(mergePullRequestStatus("DECLINED", "NONE")).toBe("DECLINED");
  });

  it("NONE + NONE = NONE", () => {
    expect(mergePullRequestStatus("NONE", "NONE")).toBe("NONE");
  });
});

// ── hasDevelopmentSummary ──

describe("hasDevelopmentSummary", () => {
  it("returns true when pullRequestCount > 0", () => {
    expect(hasDevelopmentSummary({ pullRequestStatus: "OPEN", pullRequestCount: 1, commitCount: 0 })).toBe(true);
  });

  it("returns true when commitCount > 0", () => {
    expect(hasDevelopmentSummary({ pullRequestStatus: "NONE", pullRequestCount: 0, commitCount: 5 })).toBe(true);
  });

  it("returns false when both are 0", () => {
    expect(hasDevelopmentSummary(EMPTY_DEVELOPMENT_SUMMARY)).toBe(false);
  });
});

// ── mergeDevelopmentSummaries ──

describe("mergeDevelopmentSummaries", () => {
  it("merges status with priority", () => {
    const current: DerivedDevelopmentSummary = { pullRequestStatus: "MERGED", pullRequestCount: 2, commitCount: 3 };
    const next: DerivedDevelopmentSummary = { pullRequestStatus: "OPEN", pullRequestCount: 1, commitCount: 0 };
    const merged = mergeDevelopmentSummaries(current, next);
    expect(merged.pullRequestStatus).toBe("OPEN");
  });

  it("takes max of counts", () => {
    const current: DerivedDevelopmentSummary = { pullRequestStatus: "NONE", pullRequestCount: 2, commitCount: 3 };
    const next: DerivedDevelopmentSummary = { pullRequestStatus: "NONE", pullRequestCount: 5, commitCount: 1 };
    const merged = mergeDevelopmentSummaries(current, next);
    expect(merged.pullRequestCount).toBe(5);
    expect(merged.commitCount).toBe(3);
  });

  it("returns current when next is null", () => {
    const current: DerivedDevelopmentSummary = { pullRequestStatus: "MERGED", pullRequestCount: 1, commitCount: 0 };
    expect(mergeDevelopmentSummaries(current, null)).toBe(current);
  });
});

// ── readSummaryNode ──

describe("readSummaryNode", () => {
  it("parses pullrequest structure", () => {
    const result = readSummaryNode({
      pullrequest: {
        overall: { count: 2, open: 2, state: "OPEN" },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.pullRequestCount).toBe(2);
    expect(result!.pullRequestStatus).toBe("OPEN");
  });

  it("parses commit structure", () => {
    const result = readSummaryNode({
      commit: { overall: { count: 5 } },
    });
    expect(result).not.toBeNull();
    expect(result!.commitCount).toBe(5);
  });

  it("returns null for non-object", () => {
    expect(readSummaryNode("string")).toBeNull();
    expect(readSummaryNode(null)).toBeNull();
  });

  it("returns null when no meaningful data", () => {
    expect(readSummaryNode({})).toBeNull();
  });

  it("handles summary nested structure", () => {
    const result = readSummaryNode({
      summary: {
        pullrequest: { overall: { count: 1, open: 1, state: "open" } },
        commit: { overall: { count: 3 } },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.pullRequestCount).toBe(1);
    expect(result!.commitCount).toBe(3);
  });
});

// ── readTargetsSummary ──

describe("readTargetsSummary", () => {
  it("parses Cloud targets structure with pull requests", () => {
    const result = readTargetsSummary({
      targets: {
        repository: [
          {
            type: { id: "pullrequest" },
            objects: [{ count: 3, state: "OPEN" }],
          },
        ],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.pullRequestCount).toBe(3);
    expect(result!.pullRequestStatus).toBe("OPEN");
  });

  it("parses Cloud targets structure with commits", () => {
    const result = readTargetsSummary({
      targets: {
        repository: [
          {
            type: { id: "repository" },
            objects: [{ count: 7 }],
          },
        ],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.commitCount).toBe(7);
  });

  it("returns null when no targets", () => {
    expect(readTargetsSummary({})).toBeNull();
    expect(readTargetsSummary(null)).toBeNull();
  });

  it("returns null when targets have no relevant data", () => {
    expect(
      readTargetsSummary({
        targets: {
          repo: [{ type: { id: "other" }, objects: [] }],
        },
      }),
    ).toBeNull();
  });
});

// ── looksLikeDevelopmentFieldValue ──

describe("looksLikeDevelopmentFieldValue", () => {
  it("matches strings with keywords", () => {
    expect(looksLikeDevelopmentFieldValue("pullrequest data")).toBe(true);
    expect(looksLikeDevelopmentFieldValue("commit info")).toBe(true);
    expect(looksLikeDevelopmentFieldValue("cachedValue")).toBe(true);
  });

  it("matches objects with known keys", () => {
    expect(looksLikeDevelopmentFieldValue({ summary: {} })).toBe(true);
    expect(looksLikeDevelopmentFieldValue({ targets: {} })).toBe(true);
  });

  it("returns false for non-matching strings", () => {
    expect(looksLikeDevelopmentFieldValue("plain text")).toBe(false);
  });

  it("returns false for non-matching objects", () => {
    expect(looksLikeDevelopmentFieldValue({ foo: "bar" })).toBe(false);
  });

  it("returns false for numbers/null", () => {
    expect(looksLikeDevelopmentFieldValue(42)).toBe(false);
    expect(looksLikeDevelopmentFieldValue(null)).toBe(false);
  });
});

// ── readDevelopmentFieldValue ──

describe("readDevelopmentFieldValue", () => {
  it("returns null for null payload", () => {
    expect(readDevelopmentFieldValue(null)).toBeNull();
  });

  it("reads configured field ID first", () => {
    const payload = {
      fields: {
        customfield_10000: { summary: { pullrequest: {} } },
      },
      __anathemaMeta: {
        developmentFieldIds: ["customfield_10000"],
      },
    };
    expect(readDevelopmentFieldValue(payload as any)).toEqual({
      summary: { pullrequest: {} },
    });
  });

  it("scans customfield_ keys when no configured IDs match", () => {
    const payload = {
      fields: {
        customfield_20000: "pullrequest data",
      },
    };
    expect(readDevelopmentFieldValue(payload as any)).toBe("pullrequest data");
  });

  it("returns null when no matching field found", () => {
    const payload = {
      fields: {
        customfield_99999: "some value",
      },
    };
    expect(readDevelopmentFieldValue(payload as any)).toBeNull();
  });
});

// ── deriveDevelopmentSummary ──

describe("deriveDevelopmentSummary", () => {
  it("returns empty summary for null payload", () => {
    expect(deriveDevelopmentSummary(null)).toEqual(EMPTY_DEVELOPMENT_SUMMARY);
  });

  it("returns empty summary when no development field", () => {
    expect(deriveDevelopmentSummary({ fields: {} })).toEqual(EMPTY_DEVELOPMENT_SUMMARY);
  });

  it("parses Server/DC summary structure", () => {
    const payload = {
      fields: {
        customfield_10000: {
          summary: {
            pullrequest: {
              overall: { count: 2, open: 2, state: "OPEN" },
            },
            commit: {
              overall: { count: 5 },
            },
          },
        },
      },
    };
    const result = deriveDevelopmentSummary(payload as any);
    expect(result.pullRequestCount).toBe(2);
    expect(result.pullRequestStatus).toBe("OPEN");
    expect(result.commitCount).toBe(5);
  });

  it("parses Cloud targets structure inside cachedValue", () => {
    const payload = {
      fields: {
        customfield_10000: {
          cachedValue: JSON.stringify({
            targets: {
              repo: [
                {
                  type: { id: "pullrequest" },
                  objects: [{ count: 1, state: "MERGED" }],
                },
              ],
            },
          }),
        },
      },
    };
    const result = deriveDevelopmentSummary(payload as any);
    expect(result.pullRequestCount).toBe(1);
    expect(result.pullRequestStatus).toBe("MERGED");
  });

  it("handles embedded JSON with devSummaryJson marker", () => {
    const innerJson = JSON.stringify({
      summary: {
        pullrequest: { overall: { count: 3, open: 3, state: "OPEN" } },
        commit: { overall: { count: 10 } },
      },
    });
    const payload = {
      fields: {
        customfield_10000: `prefix;devSummaryJson=${innerJson}`,
      },
    };
    const result = deriveDevelopmentSummary(payload as any);
    expect(result.pullRequestCount).toBe(3);
    expect(result.commitCount).toBe(10);
  });
});
