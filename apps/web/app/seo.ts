import type { Metadata } from "next";
import { cookies } from "next/headers";
import { defaultLocale, localeCookieName, type Locale, locales } from "./i18n/config";
import { getDictionary } from "./i18n/dictionaries";

const OG_LOCALE_MAP: Record<Locale, string> = {
  tr: "tr_TR",
  en: "en_US",
  de: "de_DE",
  pl: "pl_PL",
  es: "es_ES",
  pt: "pt_PT",
  nl: "nl_NL",
  ko: "ko_KR",
  ja: "ja_JP",
};

type TranslateVars = Record<string, string | number>;

function formatMessage(template: string, vars?: TranslateVars) {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
    template,
  );
}

function getSiteUrl() {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  try {
    return new URL(siteUrl);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export function resolveLocale(value?: string | null): Locale {
  if (value && locales.includes(value as Locale)) {
    return value as Locale;
  }
  return defaultLocale;
}

export function getRequestLocale(): Locale {
  return resolveLocale(cookies().get(localeCookieName)?.value);
}

export function getTranslator(locale: Locale) {
  const dictionary = getDictionary(locale);
  return (key: string, vars?: TranslateVars) => formatMessage(dictionary[key] ?? key, vars);
}

export function getSiteMetadata(locale: Locale): Metadata {
  const t = getTranslator(locale);
  const siteName = t("brand.name");
  const description = t("brand.subtitle");

  return {
    metadataBase: getSiteUrl(),
    applicationName: siteName,
    title: siteName,
    description,
    openGraph: {
      title: siteName,
      description,
      siteName,
      type: "website",
      locale: OG_LOCALE_MAP[locale],
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description,
    },
  };
}

export function createPageMetadata({
  locale,
  path,
  title,
  description,
}: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
}): Metadata {
  const t = getTranslator(locale);
  const siteName = t("brand.name");
  const fullTitle = title === siteName ? siteName : `${title} | ${siteName}`;

  return {
    title: fullTitle,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title: fullTitle,
      description,
      siteName,
      type: "website",
      locale: OG_LOCALE_MAP[locale],
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
    },
  };
}

export function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function buildAuthorsPath({
  q,
  school,
  city,
  country,
}: {
  q?: string;
  school?: string;
  city?: string;
  country?: string;
}) {
  const searchParams = new URLSearchParams();

  if (q?.trim()) searchParams.set("q", q.trim());
  if (school?.trim()) searchParams.set("school", school.trim());
  if (city?.trim()) searchParams.set("city", city.trim());
  if (country?.trim()) searchParams.set("country", country.trim());

  const queryString = searchParams.toString();
  return queryString ? `/authors?${queryString}` : "/authors";
}

export function buildAuthorPath(authorId?: string) {
  if (!authorId?.trim()) return "/author";
  return `/author?id=${encodeURIComponent(authorId.trim())}`;
}
