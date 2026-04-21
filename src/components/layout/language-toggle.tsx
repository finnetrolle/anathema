"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  APP_LOCALE_COOKIE,
  APP_LOCALES,
  type AppLocale,
} from "@/modules/i18n/config";

const LABELS: Record<AppLocale, Record<AppLocale, string>> = {
  ru: {
    ru: "Рус",
    en: "Eng",
  },
  en: {
    ru: "Rus",
    en: "Eng",
  },
};

const GROUP_ARIA_LABEL: Record<AppLocale, string> = {
  ru: "Переключатель языка",
  en: "Language switcher",
};

export function LanguageToggle({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLocale, setPendingLocale] = useState<AppLocale | null>(null);

  useEffect(() => {
    if (!pendingLocale || pendingLocale === locale) {
      return;
    }

    document.cookie = `${APP_LOCALE_COOKIE}=${pendingLocale}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = pendingLocale;

    startTransition(() => {
      router.refresh();
    });
  }, [locale, pendingLocale, router, startTransition]);

  const handleSelect = (nextLocale: AppLocale) => {
    if (nextLocale === locale) {
      return;
    }

    setPendingLocale(nextLocale);
  };

  return (
    <div
      aria-label={GROUP_ARIA_LABEL[locale]}
      className="language-toggle"
      data-pending={isPending}
      role="group"
    >
      {APP_LOCALES.map((value) => (
        <button
          aria-pressed={locale === value}
          className="language-toggle__button"
          data-active={locale === value}
          key={value}
          onClick={() => handleSelect(value)}
          type="button"
        >
          {LABELS[locale][value]}
        </button>
      ))}
    </div>
  );
}
