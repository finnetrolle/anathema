import { getIntlLocale, type AppLocale } from "./config";

export function getNotAvailableLabel(locale: AppLocale) {
  return locale === "ru" ? "н/д" : "n/a";
}

export function formatOptionalDate(
  value: string | null,
  locale: AppLocale,
) {
  if (!value) {
    return getNotAvailableLabel(locale);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
  }).format(parsed);
}

export function formatOptionalDateTime(
  value: string | null,
  locale: AppLocale,
) {
  if (!value) {
    return getNotAvailableLabel(locale);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function translateSyncStatus(
  status: string | null | undefined,
  locale: AppLocale,
) {
  if (status === "SUCCEEDED") {
    return locale === "ru" ? "Успешно" : "Succeeded";
  }

  if (status === "FAILED") {
    return locale === "ru" ? "Ошибка" : "Failed";
  }

  return status ?? getNotAvailableLabel(locale);
}

export function localizeUnassigned(
  value: string | null | undefined,
  locale: AppLocale,
) {
  if (!value || value === "Unassigned" || value === "Не назначен") {
    return locale === "ru" ? "Не назначен" : "Unassigned";
  }

  return value;
}

export function localizeNoComponent(
  value: string | null | undefined,
  locale: AppLocale,
) {
  if (!value || value === "No component" || value === "Без компонента") {
    return locale === "ru" ? "Без компонента" : "No component";
  }

  return value;
}
