import { describe, expect, it } from "vitest";

import {
  deriveMarker,
  deriveStartedAt,
  deriveTimelineTask,
} from "@/modules/jira/derive";
import type { JiraIssue } from "@/modules/jira/types";

type IssueOverrides = Partial<Omit<JiraIssue, "fields" | "changelog">> & {
  fields?: Partial<JiraIssue["fields"]>;
  changelog?: JiraIssue["changelog"];
};

function makeIssue(overrides: IssueOverrides = {}): JiraIssue {
  const baseIssue: JiraIssue = {
    id: "issue-1",
    key: "AN-1",
    fields: {
      summary: "Ship quality gates",
      status: {
        name: "To Do",
        statusCategory: {
          key: "new",
        },
      },
      components: [],
      creator: {
        displayName: "Alice",
      },
      reporter: {
        displayName: "Bob",
      },
      assignee: {
        accountId: "acc-1",
        displayName: "Alice",
      },
      created: "2026-04-10T08:00:00.000Z",
      updated: "2026-04-11T08:00:00.000Z",
      parent: {
        id: "epic-1",
        key: "AN-EPIC",
        fields: {
          summary: "Timeline hygiene",
        },
      },
    },
    changelog: {
      histories: [],
    },
  };

  return {
    ...baseIssue,
    ...overrides,
    fields: {
      ...baseIssue.fields,
      ...overrides.fields,
    },
    changelog: overrides.changelog ?? baseIssue.changelog,
  };
}

describe("deriveStartedAt", () => {
  it("uses the earliest transition into an in-progress status after sorting changelog histories", () => {
    const issue = makeIssue({
      changelog: {
        histories: [
          {
            id: "3",
            created: "2026-04-14T12:00:00.000Z",
            items: [
              {
                field: "status",
                fromString: "In Progress",
                toString: "Done",
              },
            ],
          },
          {
            id: "1",
            created: "2026-04-12T09:30:00.000Z",
            items: [
              {
                field: "status",
                fromString: "To Do",
                toString: "In Progress",
              },
            ],
          },
          {
            id: "2",
            created: "2026-04-13T10:00:00.000Z",
            items: [
              {
                field: "status",
                fromString: "In Progress",
                toString: "Code Review",
              },
            ],
          },
        ],
      },
    });

    expect(deriveStartedAt(issue)).toBe("2026-04-12T09:30:00.000Z");
  });
});

describe("deriveMarker", () => {
  it("maps done, due, and unresolved issues to the expected marker kind", () => {
    const doneIssue = makeIssue({
      fields: {
        status: {
          name: "Done",
          statusCategory: {
            key: "done",
          },
        },
        updated: "2026-04-16T09:00:00.000Z",
      },
      changelog: {
        histories: [
          {
            id: "1",
            created: "2026-04-15T15:00:00.000Z",
            items: [
              {
                field: "status",
                fromString: "In Progress",
                toString: "Done",
              },
            ],
          },
        ],
      },
    });
    const dueIssue = makeIssue({
      fields: {
        status: {
          name: "In Progress",
          statusCategory: {
            key: "indeterminate",
          },
        },
        duedate: "2026-04-20",
      },
    });
    const unresolvedIssue = makeIssue({
      fields: {
        status: {
          name: "In Progress",
          statusCategory: {
            key: "indeterminate",
          },
        },
        updated: "2026-04-18T10:00:00.000Z",
      },
    });

    expect(deriveMarker(doneIssue)).toEqual({
      markerAt: "2026-04-15T15:00:00.000Z",
      markerKind: "DONE",
    });
    expect(deriveMarker(dueIssue)).toEqual({
      markerAt: "2026-04-20T12:00:00.000Z",
      markerKind: "DUE",
    });
    expect(deriveMarker(unresolvedIssue)).toEqual({
      markerAt: "2026-04-18T10:00:00.000Z",
      markerKind: "NONE",
    });
  });
});

describe("deriveTimelineTask", () => {
  it("keeps due dates on the connection day and flags in-progress work without due dates", () => {
    const dueIssue = makeIssue({
      fields: {
        status: {
          name: "In Progress",
          statusCategory: {
            key: "indeterminate",
          },
        },
        duedate: "2026-04-16",
      },
    });
    const missingDueDateIssue = makeIssue({
      key: "AN-2",
      fields: {
        status: {
          name: "In Progress",
          statusCategory: {
            key: "indeterminate",
          },
        },
        assignee: null,
        duedate: null,
        updated: "2026-04-17T08:00:00.000Z",
      },
    });

    expect(
      deriveTimelineTask(dueIssue, undefined, "Pacific/Kiritimati").dueAt,
    ).toBe("2026-04-15T22:00:00.000Z");
    expect(
      deriveTimelineTask(missingDueDateIssue, undefined, "Europe/Moscow")
        .isMissingDueDate,
    ).toBe(true);
  });
});
