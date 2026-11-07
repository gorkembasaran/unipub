"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  defaultLocale,
  legacyLocaleStorageKey,
  localeCookieName,
  localeStorageKey,
  type Locale,
  locales,
} from "./config";
import { getDictionary } from "./dictionaries";

export type I18nContextValue = {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale?: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  t: (key: string) => key,
});

function format(str: string, vars?: Record<string, string | number>) {
  if (!vars) return str;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), str);
}

export function I18nProvider({
  children,
  locale: initialLocale,
}: {
  children: ReactNode;
  locale?: string;
}) {
  const resolvedInitial: Locale = locales.includes((initialLocale as Locale) ?? defaultLocale)
    ? ((initialLocale as Locale) ?? defaultLocale)
    : defaultLocale;
  const [locale, setLocale] = useState<Locale>(resolvedInitial);

  const dict = useMemo(() => getDictionary(locale), [locale]);
  const fallbackDict = useMemo(() => getDictionary("en"), []);

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(localeStorageKey) ??
          window.localStorage.getItem(legacyLocaleStorageKey)
        : null;

    if (stored && locales.includes(stored as Locale)) {
      setLocale(stored as Locale);
      if (typeof document !== "undefined") {
        document.documentElement.lang = stored;
        document.cookie = `${localeCookieName}=${stored}; path=/; max-age=31536000; SameSite=Lax`;
      }
      return;
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = resolvedInitial;
    }
  }, [resolvedInitial]);

  const value: I18nContextValue = useMemo(
    () => ({
      locale,
      t: (key: string, vars?: Record<string, string | number>) =>
        format(dict[key] ?? fallbackDict[key] ?? key, vars),
      setLocale: (nextLocale: Locale) => {
        setLocale(nextLocale);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(localeStorageKey, nextLocale);
          window.localStorage.removeItem(legacyLocaleStorageKey);
        }
        if (typeof document !== "undefined") {
          document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
          document.documentElement.lang = nextLocale;
        }
      },
    }),
    [dict, fallbackDict, locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
