"use client";

import { useEffect, useState } from "react";

import type { AppLocale } from "@/modules/i18n/config";

type Theme = "light" | "dark";

const THEME_COPY: Record<
  AppLocale,
  {
    switchToDark: string;
    switchToLight: string;
    darkMode: string;
    lightMode: string;
  }
> = {
  ru: {
    switchToDark: "Переключить на тёмную тему",
    switchToLight: "Переключить на светлую тему",
    darkMode: "Тёмная тема",
    lightMode: "Светлая тема",
  },
  en: {
    switchToDark: "Switch to dark theme",
    switchToLight: "Switch to light theme",
    darkMode: "Dark mode",
    lightMode: "Light mode",
  },
};

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle({ locale }: { locale: AppLocale }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const copy = THEME_COPY[locale];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <button
      aria-label={theme === "light" ? copy.switchToDark : copy.switchToLight}
      className="theme-toggle"
      onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
      title={theme === "light" ? copy.darkMode : copy.lightMode}
      type="button"
    >
      {theme === "light" ? (
        <svg height="18" viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg height="18" viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}
