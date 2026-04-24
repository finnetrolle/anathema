import type { CSSProperties } from "react";

import type { AppLocale } from "@/modules/i18n/config";
import { getRiskLevelLabel, type RiskLevel } from "@/modules/timeline/risk-helpers";
import type { TimelineModel, TimelineRowItem } from "@/modules/timeline/types";

export const COPY: Record<
  AppLocale,
  {
    noEstimate: string;
    mergedPrs: (count: number) => string;
    openPrs: (count: number) => string;
    declinedPrs: (count: number) => string;
    linkedPrs: (count: number) => string;
    commits: (count: number) => string;
    noCodeActivity: string;
    noWorkingDays: string;
    noTasksForPerson: (person: string) => string;
    noTasksInRange: string;
    showAll: string;
    gridHeader: string;
    tasksInLane: (count: number) => string;
    taskDetails: string;
    openInJira: string;
    closeTaskDetails: string;
    close: string;
    epic: string;
    component: string;
    epicComponent: string;
    assignee: string;
    status: string;
    created: string;
    started: string;
    dueDate: string;
    estimate: string;
    finished: string;
    assigneeHistory: string;
    author: string;
    pullRequests: string;
    commitsLabel: string;
    dateNotAvailable: string;
    startNotObserved: string;
    noDueDate: string;
    notCompleted: string;
    noAssigneesObserved: string;
    authorNotAvailable: string;
    riskFactor: string;
    riskDrivers: string;
    noRiskFactors: string;
    riskUnavailable: string;
    riskCardLabel: (score: number | null, levelLabel: string) => string;
    attention: string;
    missingDueDateWarning: string;
  }
> = {
  ru: {
    noEstimate: "Без оценки",
    mergedPrs: (count) => `Смерженные PR: ${count}`,
    openPrs: (count) => `Открытые PR: ${count}`,
    declinedPrs: (count) => `Отклонённые PR: ${count}`,
    linkedPrs: (count) => `Связанные PR: ${count}`,
    commits: (count) => `Коммиты: ${count}`,
    noCodeActivity: "Нет коммитов или pull request",
    noWorkingDays: "В выбранном диапазоне нет рабочих дней.",
    noTasksForPerson: (person) =>
      `В выбранном диапазоне таймлайна нет задач, связанных с ${person}.`,
    noTasksInRange: "В выбранный диапазон таймлайна не попадает ни одна задача.",
    showAll: "Показать всё",
    gridHeader: "Эпик / Работа",
    tasksInLane: (count) => `${count} задач в дорожке`,
    taskDetails: "Детали задачи",
    openInJira: "Открыть в Jira",
    closeTaskDetails: "Закрыть детали задачи",
    close: "Закрыть",
    epic: "Эпик",
    component: "Компонент",
    epicComponent: "Компонент эпика",
    assignee: "Исполнитель",
    status: "Статус",
    created: "Создано",
    started: "Старт",
    dueDate: "Срок",
    estimate: "Оценка",
    finished: "Завершено",
    assigneeHistory: "История исполнителей",
    author: "Автор",
    pullRequests: "Pull request",
    commitsLabel: "Коммиты",
    dateNotAvailable: "Дата недоступна",
    startNotObserved: "Старт не зафиксирован",
    noDueDate: "Срок не указан",
    notCompleted: "Не завершена",
    noAssigneesObserved: "Исполнители не зафиксированы",
    authorNotAvailable: "Автор недоступен",
    riskFactor: "Риск-фактор",
    riskDrivers: "Факторы риска",
    noRiskFactors: "Для задачи не сохранены факторы риска.",
    riskUnavailable: "Риск не посчитан",
    riskCardLabel: (score, levelLabel) =>
      score === null ? "Риск не посчитан" : `Риск-фактор: ${score} (${levelLabel})`,
    attention: "Внимание",
    missingDueDateWarning: "Задача в работе, но у неё отсутствует срок.",
  },
  en: {
    noEstimate: "No estimate",
    mergedPrs: (count) => `Merged PR${count > 1 ? "s" : ""}: ${count}`,
    openPrs: (count) => `Open PR${count > 1 ? "s" : ""}: ${count}`,
    declinedPrs: (count) => `Declined PR${count > 1 ? "s" : ""}: ${count}`,
    linkedPrs: (count) => `Linked PR${count > 1 ? "s" : ""}: ${count}`,
    commits: (count) => `Commits: ${count}`,
    noCodeActivity: "No commits or pull requests",
    noWorkingDays: "Selected range contains no working days.",
    noTasksForPerson: (person) =>
      `No tasks related to ${person} in the selected timeline range.`,
    noTasksInRange: "No tasks intersect the selected timeline range.",
    showAll: "Show all",
    gridHeader: "Epic / Work",
    tasksInLane: (count) => `${count} tasks in lane`,
    taskDetails: "Task details",
    openInJira: "Open in Jira",
    closeTaskDetails: "Close task details",
    close: "Close",
    epic: "Epic",
    component: "Component",
    epicComponent: "Epic component",
    assignee: "Assignee",
    status: "Status",
    created: "Created",
    started: "Started",
    dueDate: "Due date",
    estimate: "Estimate",
    finished: "Finished",
    assigneeHistory: "Assignee history",
    author: "Author",
    pullRequests: "Pull requests",
    commitsLabel: "Commits",
    dateNotAvailable: "Date not available",
    startNotObserved: "Start not observed",
    noDueDate: "No due date",
    notCompleted: "Not completed",
    noAssigneesObserved: "No assignees observed",
    authorNotAvailable: "Author not available",
    riskFactor: "Risk factor",
    riskDrivers: "Risk factors",
    noRiskFactors: "No risk factors were stored for this task.",
    riskUnavailable: "Risk not computed",
    riskCardLabel: (score, levelLabel) =>
      score === null ? "Risk not computed" : `Risk factor: ${score} (${levelLabel})`,
    attention: "Attention",
    missingDueDateWarning: "Task is in progress, but due date is missing.",
  },
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function joinClassNames(...classNames: Array<string | false>) {
  return classNames.filter(Boolean).join(" ");
}

export function buildCenteredPopoverStyle() {
  return {
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  } satisfies CSSProperties;
}

export function groupRowsByComponent(rows: TimelineModel["rows"]) {
  const groups = new Map<string, TimelineModel["rows"]>();

  for (const row of rows) {
    const existingRows = groups.get(row.componentName);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    groups.set(row.componentName, [row]);
  }

  return [...groups.entries()].map(([componentName, componentRows]) => ({
    componentName,
    rows: componentRows,
  }));
}

function formatEstimateValue(value: number, unit: string) {
  const formattedValue =
    Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");

  return `${formattedValue} ${unit}`;
}

export function formatEstimateLabel(item: TimelineRowItem, locale: AppLocale) {
  const parts = [
    item.estimateHours === null
      ? null
      : formatEstimateValue(item.estimateHours, "h"),
    item.estimateStoryPoints === null
      ? null
      : formatEstimateValue(item.estimateStoryPoints, "SP"),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" · ") : COPY[locale].noEstimate;
}

export function formatDevelopmentIndicatorLabel(item: TimelineRowItem, locale: AppLocale) {
  const copy = COPY[locale];

  if (item.pullRequestCount > 0) {
    if (item.pullRequestStatus === "MERGED") {
      return copy.mergedPrs(item.pullRequestCount);
    }

    if (item.pullRequestStatus === "OPEN") {
      return copy.openPrs(item.pullRequestCount);
    }

    if (item.pullRequestStatus === "DECLINED") {
      return copy.declinedPrs(item.pullRequestCount);
    }

    return copy.linkedPrs(item.pullRequestCount);
  }

  if (item.commitCount > 0) {
    return copy.commits(item.commitCount);
  }

  return copy.noCodeActivity;
}

export function buildRiskLevelClass(level: RiskLevel) {
  return `risk-level risk-level--${level.toLowerCase()}`;
}

export function formatRiskIndicatorLabel(item: TimelineRowItem, locale: AppLocale) {
  const copy = COPY[locale];
  const levelLabel =
    item.riskLevel === null ? copy.riskUnavailable : getRiskLevelLabel(item.riskLevel, locale);

  return copy.riskCardLabel(item.riskScore, levelLabel);
}
