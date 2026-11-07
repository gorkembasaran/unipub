"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { FileDown, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AuthModal } from "../components/AuthModal";
import { useAuthSession } from "../hooks/useAuthSession";
import type { CatalogPublicationDateFilter } from "@/api/platforms/catalog";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import type {
  Publication,
  SortOrder,
} from "./authorPage.types";
import {
  type AuthorPdfDocumentDraft,
  type AuthorPdfPublicationDraft,
  createAuthorPdfDocumentDraft,
  downloadAuthorPdfDocumentDraft,
} from "./authorPdfExport";
import {
  getPublicationDateFilters,
  getPublicationSortTimestamp,
  isPublicationWithinDateFilter,
} from "./authorPageUtils";
import { AuthorPageSkeleton } from "./components/AuthorPageSkeletons";
import { AuthorPageTopbar } from "./components/AuthorPageTopbar";
import { AuthorPdfEditorDocument } from "./components/AuthorPdfEditorDocument";
import { useAuthorProfileData } from "./useAuthorProfileData";

function getDateFilterFromParam(value: string | null): CatalogPublicationDateFilter {
  return value === "1" || value === "3" || value === "5" ? value : "all";
}

function getSortOrderFromParam(value: string | null): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function buildAuthorDetailHref(params: {
  affiliation: string;
  authorId: string;
  authorName: string;
  city: string;
  country: string;
  department: string;
}) {
  const search = new URLSearchParams();

  if (params.authorId) search.set("id", params.authorId);
  if (params.authorName) search.set("name", params.authorName);
  if (params.affiliation) search.set("affiliation", params.affiliation);
  if (params.department) search.set("department", params.department);
  if (params.city) search.set("city", params.city);
  if (params.country) search.set("country", params.country);

  const query = search.toString();
  return query ? `/author?${query}` : "/author";
}

function getEditorLabels(locale: string) {
  const isTurkish = locale.toLocaleLowerCase("tr-TR").startsWith("tr");

  return {
    back: isTurkish ? "Yazar detayına dön" : "Back to author detail",
    download: isTurkish ? "PDF Olarak İndir" : "Download as PDF",
    hint: isTurkish
      ? "Bu ekran indirilen dosya değil, düzenlenebilir önizlemedir. DOI, yazar adı, künye ve diğer alanları burada düzeltip yalnızca sağdaki butona bastığında PDF olarak indirebilirsin."
      : "This screen is an editable preview, not the downloaded file itself. You can correct DOI, author names, citation text and other fields here, then download as PDF with the button on the right.",
    invalid: isTurkish
      ? "Düzenlenecek yazar profili bulunamadı."
      : "No author profile found to edit.",
    loading: isTurkish ? "PDF hazırlanıyor..." : "Preparing PDF...",
    previewTitle: isTurkish ? "Düzenlenebilir Belge Önizlemesi" : "Editable Document Preview",
    reset: isTurkish ? "Sıfırla" : "Reset",
  };
}

function syncDraftTotal(
  draft: AuthorPdfDocumentDraft,
  publications: AuthorPdfPublicationDraft[],
): AuthorPdfDocumentDraft {
  return {
    ...draft,
    publications,
    total: String(publications.length),
  };
}

function AuthorPdfEditorPageContent() {
  const params = useSearchParams();
  const { t, locale } = useI18n();
  const { theme, toggle } = useTheme();
  const { authState, refreshSession } = useAuthSession();

  const authorId = params.get("id")?.trim() ?? "";
  const authorName = params.get("name")?.trim() ?? "";
  const affiliation = params.get("affiliation")?.trim() ?? "";
  const department = params.get("department")?.trim() ?? "";
  const city = params.get("city")?.trim() ?? "";
  const country = params.get("country")?.trim() ?? "";
  const dateFilter = getDateFilterFromParam(params.get("dateFilter"));
  const sortOrder = getSortOrderFromParam(params.get("sort"));

  const { author, error, loading, publications } = useAuthorProfileData({
    affiliation,
    authorId,
    authorName,
    city,
    country,
    dateFilter,
    department,
    t,
  });

  const [draft, setDraft] = useState<AuthorPdfDocumentDraft | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const labels = getEditorLabels(locale);
  const publicationDateFilters = useMemo(() => getPublicationDateFilters(t), [t]);
  const currentDateFilterLabel =
    publicationDateFilters.find((option) => option.value === dateFilter)?.label ??
    t("common.all");

  const sortedFilteredPublications = useMemo(
    () =>
      publications
        .filter((publication) => isPublicationWithinDateFilter(publication, dateFilter))
        .sort((a, b) => {
          const timestampDiff =
            sortOrder === "desc"
              ? getPublicationSortTimestamp(b) - getPublicationSortTimestamp(a)
              : getPublicationSortTimestamp(a) - getPublicationSortTimestamp(b);

          if (timestampDiff !== 0) return timestampDiff;

          return sortOrder === "desc"
            ? b.title.localeCompare(a.title, locale)
            : a.title.localeCompare(b.title, locale);
        }),
    [dateFilter, locale, publications, sortOrder],
  );

  const baseDraft = useMemo(() => {
    if (!author) return null;

    return createAuthorPdfDocumentDraft({
      author,
      publications: sortedFilteredPublications,
      locale,
      t,
      currentDateFilterLabel,
      dateFilter,
    });
  }, [author, currentDateFilterLabel, dateFilter, locale, sortedFilteredPublications, t]);

  useEffect(() => {
    if (baseDraft) {
      setDraft(baseDraft);
    }
  }, [baseDraft]);

  const backHref = buildAuthorDetailHref({
    affiliation,
    authorId,
    authorName,
    city,
    country,
    department,
  });

  const handleDocumentFieldChange = (
    field: Exclude<keyof AuthorPdfDocumentDraft, "publications">,
    value: string,
  ) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handlePublicationFieldChange = (
    publicationId: string,
    field: Exclude<keyof AuthorPdfPublicationDraft, "id">,
    value: string,
  ) => {
    setDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        publications: current.publications.map((publication) =>
          publication.id === publicationId
            ? { ...publication, [field]: value }
            : publication,
        ),
      };
    });
  };

  const handleAddPublication = () => {
    setDraft((current) => {
      if (!current) return current;

      const nextPublication: AuthorPdfPublicationDraft = {
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `manual-${Date.now()}`,
        authors: "",
        citation: "",
        doi: "",
        keywords: "",
        metadata: "",
        title: "",
        year: "",
      };

      return syncDraftTotal(current, [...current.publications, nextPublication]);
    });
  };

  const handleRemovePublication = (publicationId: string) => {
    setDraft((current) => {
      if (!current) return current;

      return syncDraftTotal(
        current,
        current.publications.filter((publication) => publication.id !== publicationId),
      );
    });
  };

  const handleReset = () => {
    if (baseDraft) {
      setDraft(baseDraft);
    }
  };

  const handleDownload = async () => {
    if (!draft || downloading) return;

    setDownloading(true);
    try {
      await downloadAuthorPdfDocumentDraft(draft, locale);
    } finally {
      setDownloading(false);
    }
  };

  if (!authorId && !authorName) {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/authors"
            backLabel={labels.back}
            brandName={t("brand.name")}
            brandSubtitle={t("brand.subtitle")}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <p className="authors-error">{labels.invalid}</p>
        </div>
      </main>
    );
  }

  if (authState === "loading") {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref={backHref}
            backLabel={labels.back}
            brandName={t("brand.name")}
            brandSubtitle={t("brand.subtitle")}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <AuthorPageSkeleton />
        </div>
      </main>
    );
  }

  if (authState !== "authenticated") {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref={backHref}
            backLabel={labels.back}
            brandName={t("brand.name")}
            brandSubtitle={t("brand.subtitle")}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />

          <section className="author-access-shell">
            <div className="author-access-card">
              <div className="author-access-copy">
                <p className="author-access-eyebrow">
                  {t("author.auth_required.kicker")}
                </p>
                <h1>{t("author.auth_required.title")}</h1>
                <p>{t("author.auth_required.export")}</p>
              </div>
              <div className="author-access-actions">
                <button
                  type="button"
                  className="pubs-export-btn"
                  onClick={() => setAuthModalOpen(true)}
                >
                  {t("home.auth.login")}
                </button>
              </div>
            </div>
          </section>

          <AuthModal
            open={authModalOpen}
            preferredMode="login"
            title={t("author.auth_required.title")}
            subtitle={t("author.auth_required.export")}
            onClose={() => setAuthModalOpen(false)}
            onSuccess={({ token }) => {
              void refreshSession(token).then((user) => {
                if (!user) return;
                setAuthModalOpen(false);
              });
            }}
          />
        </div>
      </main>
    );
  }

  if (loading && !draft) {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref={backHref}
            backLabel={labels.back}
            brandName={t("brand.name")}
            brandSubtitle={t("brand.subtitle")}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <AuthorPageSkeleton />
        </div>
      </main>
    );
  }

  return (
    <main className="author-page authors-page pdf-editor-page">
      <div className="authors-shell">
        <AuthorPageTopbar
          backHref={backHref}
          backLabel={labels.back}
          brandName={t("brand.name")}
          brandSubtitle={t("brand.subtitle")}
          theme={theme}
          themeToggleLabel={t("theme.toggle")}
          onToggleTheme={toggle}
        />

        {error ? <p className="authors-error">{error}</p> : null}

        <section className="pdf-editor-toolbar">
          <div className="pdf-editor-toolbar-copy">
            <div className="pdf-editor-toolbar-title">{labels.previewTitle}</div>
            <p className="pdf-editor-toolbar-note">{labels.hint}</p>
          </div>
          <div className="pdf-editor-toolbar-actions">
            <button
              type="button"
              className="pdf-editor-reset-btn"
              onClick={handleReset}
              disabled={!baseDraft}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>{labels.reset}</span>
            </button>
            <button
              type="button"
              className="pubs-export-btn"
              onClick={handleDownload}
              disabled={!draft || downloading}
            >
              <FileDown size={16} aria-hidden="true" />
              <span>{downloading ? labels.loading : labels.download}</span>
            </button>
          </div>
        </section>

        {draft ? (
          <AuthorPdfEditorDocument
            draft={draft}
            locale={locale}
            onAddPublication={handleAddPublication}
            onDocumentFieldChange={handleDocumentFieldChange}
            onPublicationFieldChange={handlePublicationFieldChange}
            onRemovePublication={handleRemovePublication}
          />
        ) : (
          <p className="authors-empty">{labels.invalid}</p>
        )}
      </div>
    </main>
  );
}

export default function AuthorPdfEditorPage() {
  return (
    <Suspense
      fallback={
        <main className="author-page authors-page">
          <div className="authors-shell">
            <AuthorPageSkeleton />
          </div>
        </main>
      }
    >
      <AuthorPdfEditorPageContent />
    </Suspense>
  );
}
