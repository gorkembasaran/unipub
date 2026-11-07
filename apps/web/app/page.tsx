import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import { createPageMetadata, getRequestLocale, getTranslator } from "./seo";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const t = getTranslator(locale);

  return createPageMetadata({
    locale,
    path: "/",
    title: t("home.hero.title"),
    description: t("home.hero.subtitle"),
  });
}

export default function HomePage() {
  return <HomePageClient />;
}
