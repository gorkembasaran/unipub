import type { Metadata } from "next";
import AuthorsPageClient from "./AuthorsPageClient";
import {
  buildAuthorsPath,
  createPageMetadata,
  firstSearchParam,
  getRequestLocale,
  getTranslator,
} from "../seo";

type AuthorsPageProps = {
  searchParams?: {
    q?: string | string[];
    school?: string | string[];
    city?: string | string[];
    country?: string | string[];
  };
};

export function generateMetadata({ searchParams }: AuthorsPageProps): Metadata {
  const locale = getRequestLocale();
  const t = getTranslator(locale);
  const query = firstSearchParam(searchParams?.q).trim();
  const school = firstSearchParam(searchParams?.school).trim();
  const city = firstSearchParam(searchParams?.city).trim();
  const country = firstSearchParam(searchParams?.country).trim();

  const title = query ? `${t("authors.results.title")}: ${query}` : t("authors.results.title");
  const baseDescription = query
    ? t("authors.results.subtitle", { query })
    : t("authors.search.placeholder");

  const activeFilters = [
    school ? `${t("home.search.school")}: ${school}` : "",
    city ? `${t("home.search.city")}: ${city}` : "",
    country ? `${t("home.search.country")}: ${country}` : "",
  ].filter(Boolean);

  const description = activeFilters.length
    ? `${baseDescription} ${activeFilters.join(" • ")}`
    : baseDescription;

  return createPageMetadata({
    locale,
    path: buildAuthorsPath({ q: query, school, city, country }),
    title,
    description,
  });
}

export default function AuthorsPage() {
  return <AuthorsPageClient />;
}
