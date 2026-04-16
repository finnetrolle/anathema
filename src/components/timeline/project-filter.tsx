"use client";

import { useTransition, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ProjectFilterProps = {
  options: Array<{
    id: string;
    label: string;
  }>;
  selectedProjectId: string | null;
};

const ALL_PROJECTS_VALUE = "__all_projects__";

export function ProjectFilter({
  options,
  selectedProjectId,
}: ProjectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    const nextSearchParams = new URLSearchParams(searchParams.toString());

    if (nextValue === ALL_PROJECTS_VALUE) {
      nextSearchParams.delete("project");
    } else {
      nextSearchParams.set("project", nextValue);
    }

    const nextQuery = nextSearchParams.toString();

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    });
  };

  return (
    <label className="timeline-field project-filter" data-pending={isPending}>
      <select
        aria-label="Project"
        className="project-filter__control"
        defaultValue={selectedProjectId ?? ALL_PROJECTS_VALUE}
        key={selectedProjectId ?? ALL_PROJECTS_VALUE}
        onChange={handleChange}
      >
        <option value={ALL_PROJECTS_VALUE}>All projects</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
