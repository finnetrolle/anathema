import type { AppLocale } from "@/modules/i18n/config";
import type { TimelineModel } from "@/modules/timeline/types";
import { COPY, joinClassNames } from "@/components/timeline/timeline-copy";

export function TimelineLegend({
  legend,
  activePerson,
  setActivePerson,
  assigneesWithTasksInRange,
  locale,
}: {
  legend: TimelineModel["legend"];
  activePerson: string | null;
  setActivePerson: React.Dispatch<React.SetStateAction<string | null>>;
  assigneesWithTasksInRange: Set<string>;
  locale: AppLocale;
}) {
  const copy = COPY[locale];

  return (
    <div className="timeline-board__legend">
      {activePerson ? (
        <button
          className="legend-item legend-item--button legend-item--reset"
          onClick={() => setActivePerson(null)}
          type="button"
        >
          <span>{copy.showAll}</span>
        </button>
      ) : null}

      {legend.map((entry) => {
        const hasAssigneeTasksInRange = assigneesWithTasksInRange.has(
          entry.personName,
        );

        return (
          <button
            aria-pressed={activePerson === entry.personName}
            className={joinClassNames(
              "legend-item",
              "legend-item--button",
              activePerson === entry.personName
                ? hasAssigneeTasksInRange
                  ? "legend-item--active"
                  : "legend-item--empty"
                : activePerson
                  ? "legend-item--inactive"
                  : false,
              !hasAssigneeTasksInRange && "legend-item--empty",
            )}
            key={entry.personName}
            onClick={() =>
              setActivePerson((current) =>
                current === entry.personName ? null : entry.personName,
              )
            }
            type="button"
          >
            <span
              className="legend-item__swatch"
              style={{ backgroundColor: entry.color }}
            />
            <span>{entry.personName}</span>
          </button>
        );
      })}
    </div>
  );
}
