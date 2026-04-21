import type { AppLocale } from "@/modules/i18n/config";
import type { RiskLevel, RiskReasonCode } from "./types";
import { describeRiskReason } from "./reasons";

export function getRiskLevelLabel(level: RiskLevel, locale: AppLocale) {
  if (level === "CRITICAL") {
    return locale === "ru" ? "Критический" : "Critical";
  }

  if (level === "HIGH") {
    return locale === "ru" ? "Высокий" : "High";
  }

  if (level === "MEDIUM") {
    return locale === "ru" ? "Средний" : "Medium";
  }

  return locale === "ru" ? "Низкий" : "Low";
}

export function getRiskReasonTitle(reasonCode: RiskReasonCode, locale: AppLocale) {
  return describeRiskReason(locale, reasonCode, 0, {}).title;
}

export function getRiskStateLabel(
  isNewRisk: boolean,
  isPersistentRisk: boolean,
  locale: AppLocale,
) {
  if (isNewRisk) {
    return locale === "ru" ? "Новый риск" : "New risk";
  }

  if (isPersistentRisk) {
    return locale === "ru" ? "Устойчивый" : "Persistent";
  }

  return locale === "ru" ? "Стабильно" : "Stable";
}
