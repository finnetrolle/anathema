import { describe, expect, it } from "vitest";

import {
  buildIssueDateBounds,
  buildIssueScopeWhere,
  buildVisibleIssueWhere,
  resolveScopedConnectionIds,
  resolveTimelineTimezones,
} from "@/modules/timeline/load-dashboard-helpers";

describe("load-dashboard helpers", () => {
  it("builds a project-aware issue scope that always excludes epics", () => {
    expect(buildIssueScopeWhere(null)).toEqual({
      issueType: {
        not: "Epic",
      },
    });
    expect(buildIssueScopeWhere("project-1")).toEqual({
      issueType: {
        not: "Epic",
      },
      jiraProjectId: "project-1",
    });
  });

  it("derives the visible query window from scope and timeline dates", () => {
    const visibleStart = new Date("2026-04-13T00:00:00.000Z");
    const visibleEnd = new Date("2026-04-17T23:59:59.999Z");

    expect(
      buildVisibleIssueWhere(buildIssueScopeWhere("project-1"), visibleStart, visibleEnd),
    ).toEqual({
      AND: [
        {
          issueType: {
            not: "Epic",
          },
          jiraProjectId: "project-1",
        },
        {
          OR: [
            {
              AND: [
                {
                  startedAt: {
                    not: null,
                  },
                },
                {
                  startedAt: {
                    lte: visibleEnd,
                  },
                },
                {
                  markerAt: {
                    gte: visibleStart,
                  },
                },
              ],
            },
            {
              AND: [
                {
                  startedAt: null,
                },
                {
                  dueAt: {
                    not: null,
                  },
                },
                {
                  dueAt: {
                    gte: visibleStart,
                  },
                },
              ],
            },
            {
              AND: [
                {
                  startedAt: null,
                },
                {
                  dueAt: null,
                },
                {
                  markerKind: "NONE",
                },
              ],
            },
            {
              AND: [
                {
                  startedAt: null,
                },
                {
                  markerKind: "DONE",
                },
                {
                  markerAt: {
                    gte: visibleStart,
                  },
                },
                {
                  markerAt: {
                    lte: visibleEnd,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("calculates issue date bounds and scoped connection metadata deterministically", () => {
    expect(
      buildIssueDateBounds({
        _min: {
          startedAt: new Date("2026-04-14T09:00:00.000Z"),
          dueAt: new Date("2026-04-12T09:00:00.000Z"),
          markerAt: new Date("2026-04-13T09:00:00.000Z"),
        },
        _max: {
          startedAt: new Date("2026-04-18T09:00:00.000Z"),
          dueAt: new Date("2026-04-19T09:00:00.000Z"),
          markerAt: new Date("2026-04-17T09:00:00.000Z"),
        },
      }),
    ).toEqual({
      minDate: new Date("2026-04-12T09:00:00.000Z"),
      maxDate: new Date("2026-04-19T09:00:00.000Z"),
    });
    expect(
      resolveScopedConnectionIds([
        {
          connection: {
            id: "b-connection",
          },
        },
        {
          connection: {
            id: "a-connection",
          },
        },
        {
          connection: {
            id: "b-connection",
          },
        },
      ]),
    ).toEqual(["a-connection", "b-connection"]);
    expect(
      resolveTimelineTimezones([
        {
          connection: {
            timezone: "Europe/Moscow",
          },
        },
        {
          connection: {
            timezone: "America/Los_Angeles",
          },
        },
        {
          connection: {
            timezone: "Europe/Moscow",
          },
        },
      ]),
    ).toEqual(["America/Los_Angeles", "Europe/Moscow"]);
  });
});
