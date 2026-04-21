export const APP_LOCALES = ["ru", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "ru";
export const APP_LOCALE_COOKIE = "anathema-locale";

const INTL_LOCALE_BY_APP_LOCALE: Record<AppLocale, string> = {
  ru: "ru-RU",
  en: "en-US",
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "ru" || value === "en";
}

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE;
}

export function getIntlLocale(locale: AppLocale) {
  return INTL_LOCALE_BY_APP_LOCALE[locale];
}
