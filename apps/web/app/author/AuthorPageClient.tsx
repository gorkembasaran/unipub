"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getStoredAuthToken } from "@/api";
import type {
  CatalogPublicationDateFilter,
} from "@/api/platforms/catalog";
import { AuthModal } from "../components/AuthModal";
import { useAuthSession } from "../hooks/useAuthSession";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import { getApiErrorMessage } from "../utils/apiErrors";
import type {
  Publication,
  PublicationYearGroup,
  SortOrder,
} from "./authorPage.types";
import {
  formatSyncDate,
  getPublicationDateFilters,
  getPublicationSortTimestamp,
  getPublicationYear,
  isPublicationWithinDateFilter,
} from "./authorPageUtils";
import { AuthorHero } from "./components/AuthorHero";
import {
  AuthorHeroSkeleton,
  AuthorPageSkeleton,
  AuthorPublicationsSkeleton,
} from "./components/AuthorPageSkeletons";
import { AuthorPageTopbar } from "./components/AuthorPageTopbar";
import { AuthorPublicationsSection } from "./components/AuthorPublicationsSection";
import { useAuthorProfileData } from "./useAuthorProfileData";

function AuthorPageContent() {
  const router = useRouter();
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
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [dateFilter, setDateFilter] =
    useState<CatalogPublicationDateFilter>("all");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalIntent, setAuthModalIntent] = useState<"export" | "refresh">("export");
  const [actionFeedback, setActionFeedback] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);
  const [refreshRequestLoading, setRefreshRequestLoading] = useState(false);
  const [refreshRequestSent, setRefreshRequestSent] = useState(false);
  const { author, error, loading, profileSource, publications, syncResult, syncing } =
    useAuthorProfileData({
      affiliation,
      authorId,
      authorName,
      city,
      country,
      dateFilter,
      department,
      t,
    });

  const availableProviders = useMemo(
    () => (syncResult?.providers ?? []).filter((provider) => provider.status !== "skipped"),
    [syncResult],
  );

  const filteredPublications = useMemo(
    () =>
      publications.filter((publication) =>
        isPublicationWithinDateFilter(publication, dateFilter),
      ),
    [dateFilter, publications],
  );

  const sortedFilteredPublications = useMemo(
    () =>
      [...filteredPublications].sort((a, b) => {
      const timestampDiff =
        sortOrder === "desc"
          ? getPublicationSortTimestamp(b) - getPublicationSortTimestamp(a)
          : getPublicationSortTimestamp(a) - getPublicationSortTimestamp(b);

      if (timestampDiff !== 0) return timestampDiff;

      return sortOrder === "desc"
        ? b.title.localeCompare(a.title, locale)
        : a.title.localeCompare(b.title, locale);
      }),
    [filteredPublications, locale, sortOrder],
  );

  const publicationsByYear = useMemo<PublicationYearGroup[]>(() => {
    const groups = new Map<number | null, Publication[]>();

    sortedFilteredPublications.forEach((publication) => {
      const year = getPublicationYear(publication);
      const current = groups.get(year) ?? [];
      current.push(publication);
      groups.set(year, current);
    });

    return Array.from(groups.entries())
      .sort((a, b) => {
        if (a[0] === null) return 1;
        if (b[0] === null) return -1;
        return sortOrder === "desc" ? b[0] - a[0] : a[0] - b[0];
      })
      .map(([year, items]) => ({ year, items }));
  }, [sortOrder, sortedFilteredPublications]);

  const publicationDateFilters = useMemo(() => getPublicationDateFilters(t), [t]);
  const currentDateFilterLabel =
    publicationDateFilters.find((option) => option.value === dateFilter)?.label ??
    t("common.all");
  const isCatalogSearchProfile = profileSource === "catalog";
  const syncLabel = profileSource === "live_search"
    ? t("author.profile.source.live_search")
    : formatSyncDate(syncResult, locale, t);
  const showInitialLoading = loading && !author && publications.length === 0;
  const showPublicationSkeleton = loading && Boolean(author);
  const resolvedAuthorId = author?._id?.trim() ?? authorId;
  const refreshRequestAvailable =
    profileSource === "catalog" && Boolean(author?._id?.trim());
  const pdfEditorHref = useMemo(() => {
    const search = new URLSearchParams();

    if (authorId) {
      search.set("id", authorId);
    }

    if (authorName) {
      search.set("name", authorName);
    }

    if (affiliation) search.set("affiliation", affiliation);
    if (department) search.set("department", department);
    if (city) search.set("city", city);
    if (country) search.set("country", country);

    search.set("dateFilter", dateFilter);
    search.set("sort", sortOrder);

    return `/author/export?${search.toString()}`;
  }, [affiliation, authorId, authorName, city, country, dateFilter, department, sortOrder]);
  const authModalSubtitle =
    authModalIntent === "refresh"
      ? t("author.auth_required.refresh_request")
      : t("author.auth_required.export");

  useEffect(() => {
    setActionFeedback(null);
    setRefreshRequestSent(false);
    setRefreshRequestLoading(false);
  }, [resolvedAuthorId]);

  const openAuthModalForIntent = (
    intent: "export" | "refresh",
    action: () => void | Promise<void>,
  ) => {
    pendingActionRef.current = action;
    setAuthModalIntent(intent);
    setAuthModalOpen(true);
  };

  const runProtectedAction = async (
    intent: "export" | "refresh",
    action: () => void | Promise<void>,
  ) => {
    const storedToken = getStoredAuthToken();

    if (!storedToken) {
      openAuthModalForIntent(intent, action);
      return;
    }

    if (authState !== "authenticated") {
      const user = await refreshSession(storedToken);
      if (!user) {
        openAuthModalForIntent(intent, action);
        return;
      }
    }

    await action();
  };

  const handleExport = () => {
    setActionFeedback(null);
    void runProtectedAction("export", () => {
      router.push(pdfEditorHref);
    });
  };

  const submitRefreshRequest = async () => {
    if (!refreshRequestAvailable || !author?._id) {
      setActionFeedback({
        type: "error",
        text: t("author.publications.refresh_request_unavailable"),
      });
      return;
    }

    setRefreshRequestLoading(true);
    setActionFeedback(null);

    try {
      const response = await api.discovery.requestAuthorRefresh(author._id, {
        authorName: author.fullName,
        context: "author_detail",
        profilePath:
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : undefined,
      });

      setRefreshRequestSent(true);
      setActionFeedback({
        type: "success",
        text:
          response.message?.trim() ||
          t("author.publications.refresh_request_sent"),
      });
    } catch (requestError) {
      setActionFeedback({
        type: "error",
        text: getApiErrorMessage(
          requestError,
          t("author.publications.refresh_request_failed"),
        ),
      });
    } finally {
      setRefreshRequestLoading(false);
    }
  };

  const handleRefreshRequest = () => {
    if (!refreshRequestAvailable) {
      setActionFeedback({
        type: "error",
        text: t("author.publications.refresh_request_unavailable"),
      });
      return;
    }

    void runProtectedAction("refresh", () => {
      void submitRefreshRequest();
    });
  };

  if (!authorId && !authorName) {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/authors"
            backLabel={t("authors.back")}
            brandName={t("brand.name")}
            brandSubtitle={t("brand.subtitle")}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <p className="authors-error">{t("author.profile.invalid")}</p>
        </div>
      </main>
    );
  }

  if (showInitialLoading) {
    return (
      <main className="author-page authors-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/authors"
            backLabel={t("authors.back")}
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
    <main className="author-page authors-page">
      <div className="authors-shell">
        <AuthorPageTopbar
          backHref="/authors"
          backLabel={t("authors.back")}
          brandName={t("brand.name")}
          brandSubtitle={t("brand.subtitle")}
          theme={theme}
          themeToggleLabel={t("theme.toggle")}
          onToggleTheme={toggle}
        />

        {error ? <p className="authors-error">{error}</p> : null}

        {author ? <AuthorHero author={author} t={t} /> : null}

        {showPublicationSkeleton ? (
          <AuthorPublicationsSkeleton />
        ) : !loading ? (
          <AuthorPublicationsSection
            availableProviders={availableProviders}
            feedback={actionFeedback}
            currentDateFilterLabel={currentDateFilterLabel}
            dateFilter={dateFilter}
            dateFilterOptions={publicationDateFilters}
            filteredPublicationsCount={filteredPublications.length}
            isCatalogSearchProfile={isCatalogSearchProfile}
            isRequestingRefresh={refreshRequestLoading}
            locale={locale}
            publicationsByYear={publicationsByYear}
            refreshRequestAvailable={refreshRequestAvailable}
            refreshRequestSent={refreshRequestSent}
            sortOrder={sortOrder}
            syncLabel={syncing ? `${syncLabel}...` : syncLabel}
            t={t}
            onDateFilterChange={setDateFilter}
            onExport={handleExport}
            onRequestRefresh={handleRefreshRequest}
            onSortToggle={() =>
              setSortOrder((current) => (current === "desc" ? "asc" : "desc"))
            }
          />
        ) : null}

        <AuthModal
          open={authModalOpen}
          preferredMode="login"
          title={t("author.auth_required.title")}
          subtitle={authModalSubtitle}
          onClose={() => {
            pendingActionRef.current = null;
            setAuthModalOpen(false);
          }}
          onSuccess={({ token }) => {
            void refreshSession(token).then((user) => {
              if (!user) {
                return;
              }

              const pendingAction = pendingActionRef.current;
              pendingActionRef.current = null;
              setAuthModalOpen(false);
              pendingAction?.();
            });
          }}
        />
      </div>
    </main>
  );
}

export default function AuthorPage() {
  return (
    <Suspense
      fallback={
        <main className="author-page authors-page">
          <div className="authors-shell">
            <AuthorHeroSkeleton />
            <AuthorPublicationsSkeleton />
          </div>
        </main>
      }
    >
      <AuthorPageContent />
    </Suspense>
  );
}
