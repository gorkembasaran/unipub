"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/api";
import type { CatalogAuthorSummary } from "@/api/platforms/catalog";
import { isDemoMode } from "../demoMode";
import { useI18n } from "../i18n/I18nProvider";

function buildProfileHref(author: CatalogAuthorSummary) {
  const params = new URLSearchParams({ id: author._id, name: author.fullName });
  if (author.university) {
    params.set("affiliation", author.university);
  }
  return `/author?${params.toString()}`;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("tr-TR"))
    .join("");
}

// Demo only: lets visitors browse the seeded researchers without knowing a name.
export function DemoResearchers() {
  const { t } = useI18n();
  const [authors, setAuthors] = useState<CatalogAuthorSummary[]>([]);

  useEffect(() => {
    if (!isDemoMode) {
      return;
    }

    api.catalog
      .listAuthors(24)
      .then(setAuthors)
      .catch(() => setAuthors([]));
  }, []);

  if (!isDemoMode || authors.length === 0) {
    return null;
  }

  return (
    <section className="demo-researchers">
      <div className="home-section-head">
        <h2>{t("home.researchers.title")}</h2>
        <p>{t("home.researchers.subtitle")}</p>
      </div>
      <div className="demo-researchers-grid">
        {authors.map((author) => (
          <Link key={author._id} href={buildProfileHref(author)} className="demo-researcher-card">
            <span className="demo-researcher-avatar" aria-hidden="true">
              {getInitials(author.fullName)}
            </span>
            <span className="demo-researcher-body">
              <strong>{author.fullName}</strong>
              {author.university ? <span>{author.university}</span> : null}
              <em>{t("home.researchers.publications", { count: author.publicationCount })}</em>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
