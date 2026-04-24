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

