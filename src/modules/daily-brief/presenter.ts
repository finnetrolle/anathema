import type {
  DailyBriefCounts,
  DailyBriefImportance,
  DailyBriefItemDetails,
  DailyBriefItemType,
  DailyBriefScope,
  DailyBriefScopeType,
  DailyBriefViewItem,
  DailyBriefWindowPreset,
} from "./types";
import type { AppLocale } from "@/modules/i18n/config";
import { localizeNoComponent, localizeUnassigned } from "@/modules/i18n/presenter";

export function getDailyBriefImportanceLabel(
  importance: DailyBriefImportance,
  locale: AppLocale,
) {
  if (importance === "HIGH") {
    return locale === "ru" ? "Высокий" : "High";
  }

  if (importance === "MEDIUM") {
    return locale === "ru" ? "Средний" : "Medium";
  }

  return locale === "ru" ? "Низкий" : "Low";
}

export function getDailyBriefScopeTypeLabel(
  scopeType: DailyBriefScopeType,
  locale: AppLocale,
) {
  if (scopeType === "PROJECT") {
    return locale === "ru" ? "Проект" : "Project";
  }

  if (scopeType === "PERSON") {
    return locale === "ru" ? "Человек" : "Person";
  }

  return locale === "ru" ? "Команда" : "Team";
}

export function getDailyBriefPresetLabel(
  preset: DailyBriefWindowPreset,
  locale: AppLocale,
) {
  if (preset === "PREVIOUS_BUSINESS_DAY") {
    return locale === "ru" ? "С прошлого рабочего дня" : "Since previous business day";
  }

  if (preset === "LAST_24H") {
    return locale === "ru" ? "Последние 24 часа" : "Last 24h";
  }

  return locale === "ru" ? "Произвольный" : "Custom";
}

export function formatDailyBriefScopeLabel(
  scope: Pick<DailyBriefScope, "type" | "label" | "connectionName">,
  locale: AppLocale,
) {
  if (scope.type === "TEAM") {
    return `${locale === "ru" ? "Команда" : "Team"} · ${scope.connectionName}`;
  }

  return scope.label;
}

export function buildDailyBriefHeadline(
  scopeLabel: string,
  counts: DailyBriefCounts,
  locale: AppLocale,
) {
  return locale === "ru"
    ? `${scopeLabel}: завершено ${counts.completedCount}, стартовало ${counts.startedCount}, требуют внимания ${counts.attentionCount}`
    : `${scopeLabel}: ${counts.completedCount} completed, ${counts.startedCount} started, ${counts.attentionCount} need attention`;
}

function buildDailyBriefReason(
  itemType: DailyBriefItemType,
  details: DailyBriefItemDetails,
  locale: AppLocale,
) {
  switch (itemType) {
    case "COMPLETED":
      return locale === "ru"
        ? "Задача перешла в done в выбранном окне."
        : "The issue moved into done during the selected window.";
    case "STARTED":
      return locale === "ru"
        ? "Задача перешла в активную работу в выбранном окне."
        : "The issue moved into active work during the selected window.";
    case "REOPENED":
      return locale === "ru"
        ? "Задача вернулась из завершённого состояния обратно в работу."
        : "The issue moved back into work after being done.";
    case "OVERDUE":
      return locale === "ru"
        ? "Задача всё ещё открыта после своего срока."
        : "The issue is still open past its due date.";
    case "STALE_IN_PROGRESS":
      return locale === "ru"
        ? "Задача зависла в in progress без движения по статусу и без code activity."
        : "The issue stayed in progress with no status movement or code activity in the selected window.";
    case "NO_CODE_ACTIVITY":
      return locale === "ru"
        ? "Задача в работе, но у неё нет связанных коммитов или pull request."
        : "The issue is in progress but has no linked commits or pull requests.";
    case "MISSING_DUE_DATE":
      return locale === "ru"
        ? "Задача в работе без срока."
        : "The issue is in progress without a due date.";
    case "MISSING_ESTIMATE":
      return locale === "ru"
        ? "Задача в работе без оценки."
        : "The issue is in progress without an estimate.";
    case "OWNERSHIP_CHANGED": {
      const previousAssignee = localizeUnassigned(details.previousAssigneeName, locale);
      const nextAssignee = localizeUnassigned(
        details.nextAssigneeName ?? details.currentAssigneeName,
        locale,
      );

      return locale === "ru"
        ? `Исполнитель сменился с "${previousAssignee}" на "${nextAssignee}".`
        : `Ownership changed from "${previousAssignee}" to "${nextAssignee}".`;
    }
    case "DONE_WITHOUT_PR":
      return locale === "ru"
        ? "Задача была завершена без связанной активности по pull request."
        : "The issue reached done without any linked pull request activity.";
  }
}

export function getDailyBriefReason(
  item: Pick<DailyBriefViewItem, "itemType" | "details">,
  locale: AppLocale,
) {
  return buildDailyBriefReason(item.itemType, item.details, locale);
}

export function localizeDailyBriefEpicKey(
  epicKey: string | null | undefined,
  locale: AppLocale,
) {
  return epicKey ?? (locale === "ru" ? "Без эпика" : "No epic");
}

export function localizeDailyBriefComponent(
  componentName: string | null | undefined,
  locale: AppLocale,
) {
  return localizeNoComponent(componentName, locale);
}

export function localizeDailyBriefAssignee(
  assigneeName: string | null | undefined,
  locale: AppLocale,
) {
  return localizeUnassigned(assigneeName, locale);
}
