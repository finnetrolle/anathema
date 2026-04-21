"use client";

import { useTransition, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AppLocale } from "@/modules/i18n/config";

type ProjectFilterProps = {
  options: Array<{
    id: string;
    label: string;
  }>;
  selectedProjectId: string | null;
  locale: AppLocale;
};

const ALL_PROJECTS_VALUE = "__all_projects__";

const COPY: Record<
  AppLocale,
  {
    project: string;
    allProjects: string;
  }
> = {
  ru: {
    project: "Проект",
    allProjects: "Все проекты",
  },
  en: {
    project: "Project",
    allProjects: "All projects",
  },
};

export function ProjectFilter({
  options,
  selectedProjectId,
  locale,
}: ProjectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const copy = COPY[locale];

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
        aria-label={copy.project}
        className="project-filter__control"
        defaultValue={selectedProjectId ?? ALL_PROJECTS_VALUE}
        key={selectedProjectId ?? ALL_PROJECTS_VALUE}
        onChange={handleChange}
      >
        <option value={ALL_PROJECTS_VALUE}>{copy.allProjects}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
