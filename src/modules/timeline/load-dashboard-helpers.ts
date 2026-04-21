import type { Prisma } from "@prisma/client";

import type { TimelineDateBounds } from "@/modules/timeline/build-timeline";
import { normalizeTimelineTimezones } from "@/modules/timeline/date-helpers";

type TimelineScopedProjectWithTimezone = {
  connection: {
    timezone: string;
  };
};

type TimelineScopedProjectWithConnectionId = {
  connection: {
    id: string;
  };
};

export function resolveTimelineTimezones(
  scopedProjects: TimelineScopedProjectWithTimezone[],
) {
  return normalizeTimelineTimezones(
    scopedProjects.map((project) => project.connection.timezone),
  );
}

export function resolveScopedConnectionIds(
  scopedProjects: TimelineScopedProjectWithConnectionId[],
) {
  return [...new Set(scopedProjects.map((project) => project.connection.id))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function buildIssueScopeWhere(
  selectedProjectId: string | null,
): Prisma.IssueWhereInput {
  return {
    issueType: {
      not: "Epic",
    },
    ...(selectedProjectId ? { jiraProjectId: selectedProjectId } : {}),
  };
}

function pickEarlierDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => value instanceof Date);

  if (dates.length === 0) {
    return null;
  }

  return new Date(Math.min(...dates.map(Number)));
}

function pickLaterDate(...values: Array<Date | null | undefined>) {
  const dates = values.filter((value): value is Date => value instanceof Date);

  if (dates.length === 0) {
    return null;
  }

  return new Date(Math.max(...dates.map(Number)));
}

export function buildIssueDateBounds(summary: {
  _min: {
    startedAt: Date | null;
    dueAt: Date | null;
    markerAt: Date | null;
  };
  _max: {
    startedAt: Date | null;
    dueAt: Date | null;
    markerAt: Date | null;
  };
}): TimelineDateBounds {
  return {
    minDate: pickEarlierDate(
      summary._min.startedAt,
      summary._min.dueAt,
      summary._min.markerAt,
    ),
    maxDate: pickLaterDate(
      summary._max.startedAt,
      summary._max.dueAt,
      summary._max.markerAt,
    ),
  };
}

export function buildVisibleIssueWhere(
  scopeWhere: Prisma.IssueWhereInput,
  visibleStart: Date,
  visibleEnd: Date,
): Prisma.IssueWhereInput {
  return {
    AND: [
      scopeWhere,
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
  };
}
