import {
  DEFAULT_APP_LOCALE,
  type AppLocale,
} from "@/modules/i18n/config";

import type { RiskReasonCode, RiskReasonView } from "./types";

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

export function describeRiskReason(
  locale: AppLocale = DEFAULT_APP_LOCALE,
  reasonCode: RiskReasonCode,
  weight: number,
  details: Record<string, unknown>,
): RiskReasonView {
  switch (reasonCode) {
    case "OVERDUE": {
      const daysOverdue = readNumber(details.daysOverdue);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Просрочена" : "Past due date",
        narrative:
          daysOverdue && daysOverdue > 0
            ? locale === "ru"
              ? `Задача просрочена на ${daysOverdue} дн.`
              : `The issue is ${daysOverdue} day(s) overdue.`
            : locale === "ru"
              ? "Задача уже вышла за свой due date."
              : "The issue is already past its due date.",
        recommendedAction:
          locale === "ru"
            ? "Проверь блокер и либо сдвинь срок, либо срочно сократи scope."
            : "Check the blocker and either move the deadline or urgently reduce scope.",
        details,
      };
    }
    case "AGING_WIP": {
      const ageDays = readNumber(details.ageDays);
      const severity = readString(details.severity);

      return {
        reasonCode,
        weight,
        title:
          severity === "critical"
            ? locale === "ru"
              ? "Критически старый WIP"
              : "Critical aging WIP"
            : locale === "ru"
              ? "Старый WIP"
              : "Aging WIP",
        narrative:
          ageDays && ageDays > 0
            ? locale === "ru"
              ? `Работа висит in progress уже ${ageDays} дн.`
              : `The work has stayed in progress for ${ageDays} day(s).`
            : locale === "ru"
              ? "Работа слишком долго остается в in progress."
              : "The work has been in progress for too long.",
        recommendedAction:
          locale === "ru"
            ? "Проведи быстрый review статуса: есть ли движение, нужен ли split или смена owner."
            : "Review the status quickly: is work moving, should it be split, or does ownership need to change?",
        details,
      };
    }
    case "MISSING_ESTIMATE":
      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Нет оценки" : "No estimate",
        narrative:
          locale === "ru"
            ? "Задача в работе без story points или time estimate."
            : "The issue is in progress without story points or a time estimate.",
        recommendedAction:
          locale === "ru"
            ? "Добавь оценку, чтобы риск и загрузка были сравнимы с остальным планом."
            : "Add an estimate so risk and load can be compared with the rest of the plan.",
        details,
      };
    case "MISSING_DUE_DATE":
      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Нет срока" : "No due date",
        narrative:
          locale === "ru"
            ? "Задача в работе без контрольной даты."
            : "The issue is in progress without a due date.",
        recommendedAction:
          locale === "ru"
            ? "Зафиксируй ожидаемый срок или явно пометь задачу как безжесткого дедлайна."
            : "Set an expected deadline or explicitly mark the issue as not having a hard due date.",
        details,
      };
    case "NO_DEV_ACTIVITY": {
      const staleDays = readNumber(details.staleDays);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Нет dev-активности" : "No dev activity",
        narrative:
          staleDays && staleDays > 0
            ? locale === "ru"
              ? `В задаче нет PR/commit активности уже ${staleDays} дн.`
              : `There has been no PR or commit activity for ${staleDays} day(s).`
            : locale === "ru"
              ? "В задаче нет видимой PR/commit активности."
              : "There is no visible PR or commit activity on the issue.",
        recommendedAction:
          locale === "ru"
            ? "Уточни, идет ли реальная работа вне кода, или задача застряла без инженерного прогресса."
            : "Check whether real work is happening outside the codebase or whether the issue is stuck without engineering progress.",
        details,
      };
    }
    case "ASSIGNEE_CHURN": {
      const reassignmentCount = readNumber(details.reassignmentCount);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Частая смена owner" : "Ownership churn",
        narrative:
          reassignmentCount && reassignmentCount > 0
            ? locale === "ru"
              ? `Задачу уже перекидывали ${reassignmentCount} раз.`
              : `The issue has already been reassigned ${reassignmentCount} time(s).`
            : locale === "ru"
              ? "У задачи нестабильный owner."
              : "The issue does not have stable ownership.",
        recommendedAction:
          locale === "ru"
            ? "Закрепи явного owner и проверь, не скрывается ли за handoff системный блокер."
            : "Assign a clear owner and check whether the handoff is hiding a systemic blocker.",
        details,
      };
    }
    case "REOPENED": {
      const reopenedCount = readNumber(details.reopenedCount);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Переоткрытая работа" : "Reopened work",
        narrative:
          reopenedCount && reopenedCount > 1
            ? locale === "ru"
              ? `Задача переоткрывалась ${reopenedCount} раз после done.`
              : `The issue was reopened ${reopenedCount} time(s) after completion.`
            : locale === "ru"
              ? "Задача уже возвращалась из done обратно в работу."
              : "The issue has already moved back into work after being done.",
        recommendedAction:
          locale === "ru"
            ? "Проверь acceptance criteria и качество handoff перед повторным закрытием."
            : "Check the acceptance criteria and handoff quality before closing it again.",
        details,
      };
    }
    case "HIGH_RISK_CHILDREN": {
      const riskyIssueCount = readNumber(details.riskyIssueCount);
      const entityType = readString(details.entityType);

      return {
        reasonCode,
        weight,
        title:
          entityType === "EPIC"
            ? locale === "ru"
              ? "Слишком много рискованных дочерних задач"
              : "Too many risky child issues"
            : locale === "ru"
              ? "Растущий рискованный кластер"
              : "Risky cluster growing",
        narrative:
          riskyIssueCount && riskyIssueCount > 0
            ? locale === "ru"
              ? `Внутри сущности уже ${riskyIssueCount} задач уровня HIGH/CRITICAL.`
              : `There are already ${riskyIssueCount} HIGH/CRITICAL issues inside this entity.`
            : locale === "ru"
              ? "Внутри сущности накопилось слишком много рискованных задач."
              : "Too many risky issues have accumulated inside this entity.",
        recommendedAction:
          locale === "ru"
            ? "Разверни список child issues и отработай самые дорогие причины риска по одной."
            : "Open the child issue list and work through the most expensive risk drivers one by one.",
        details,
      };
    }
    case "SPREAD_RISK": {
      const components = readStringArray(details.components);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Расползание риска" : "Risk spread",
        narrative:
          components.length > 1
            ? locale === "ru"
              ? `Риск уже размазан по нескольким компонентам: ${components.join(", ")}.`
              : `Risk is already spread across several components: ${components.join(", ")}.`
            : locale === "ru"
              ? "Риск уже затрагивает несколько частей delivery."
              : "Risk is already affecting multiple parts of delivery.",
        recommendedAction:
          locale === "ru"
            ? "Скоординируй зависимые команды и проверь, есть ли общий блокер на несколько зон сразу."
            : "Coordinate the dependent teams and check whether a shared blocker is affecting several areas at once.",
        details,
      };
    }
    case "CONCENTRATION_RISK": {
      const riskyIssueCount = readNumber(details.riskyIssueCount);
      const sharePercent = readNumber(details.sharePercent);

      return {
        reasonCode,
        weight,
        title: locale === "ru" ? "Концентрация риска" : "Concentration risk",
        narrative:
          riskyIssueCount && riskyIssueCount > 0
            ? sharePercent && sharePercent > 0
              ? locale === "ru"
                ? `${riskyIssueCount} рискованных задач сконцентрированы здесь (${sharePercent}% от текущего scope).`
                : `${riskyIssueCount} risky issues are concentrated here (${sharePercent}% of the current scope).`
              : locale === "ru"
                ? `${riskyIssueCount} рискованных задач сконцентрированы здесь.`
                : `${riskyIssueCount} risky issues are concentrated here.`
            : locale === "ru"
              ? "Риск непропорционально концентрируется в одной зоне."
              : "Risk is disproportionately concentrated in one area.",
        recommendedAction:
          locale === "ru"
            ? "Проверь перегрузку и перераспредели часть работы, если hotspot уже тормозит поток."
            : "Check for overload and redistribute part of the work if the hotspot is already slowing the flow.",
        details,
      };
    }
  }
}
