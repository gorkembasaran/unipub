"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  GitMerge,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { api } from "@/api";
import type { AdminCatalogAuthor } from "@/api";
import { AuthorPageTopbar } from "../../author/components/AuthorPageTopbar";
import { useI18n } from "../../i18n/I18nProvider";
import { useTheme } from "../../theme/ThemeProvider";
import { getAdminCopy } from "../adminCopy";
import {
  getAdminAuthorBundleCached,
  invalidateAdminAuthorBundle,
  invalidateAdminAuthorSearches,
  searchAdminAuthorsCached,
} from "../adminDataCache";
import { getAdminWorkflowsCopy } from "../adminWorkflowsCopy";
import {
  dedupeAuthorResults,
  getErrorMessage,
} from "../adminUtils";
import { AdminAuthorResultsList } from "../components/AdminAuthorResultsList";
import { AdminAuthorSnapshotCard } from "../components/AdminAuthorSnapshotCard";
import { AdminOperationModal } from "../components/AdminOperationModal";
import { AdminOperationNav } from "../components/AdminOperationNav";
import { AdminWorkspaceNav } from "../components/AdminWorkspaceNav";
import { useAdminSession } from "../useAdminSession";

type AuthorBundle = {
  author: AdminCatalogAuthor;
  publicationsCount: number;
};

export default function MergeAdminPageClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, toggle } = useTheme();
  const { locale, t } = useI18n();
  const copy = useMemo(() => getAdminCopy(locale), [locale]);
  const workflowCopy = useMemo(() => getAdminWorkflowsCopy(locale), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const { authState, currentUser } = useAdminSession();

  const presetQuery = searchParams.get("q")?.trim() ?? "";
  const [query, setQuery] = useState(presetQuery);
  const [results, setResults] = useState<AdminCatalogAuthor[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [primaryBundle, setPrimaryBundle] = useState<AuthorBundle | null>(null);
  const [secondaryBundle, setSecondaryBundle] = useState<AuthorBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const hydratedQueryRef = useRef("");
  const primaryAuthorIdRef = useRef("");
  const loadedPresetAuthorIdRef = useRef<string | null>(null);
  const primarySelectionVersionRef = useRef(0);

  const adminBrandName = `${t("brand.name")} Admin`;
  const currentUserLabel =
    currentUser?.fullName ?? currentUser?.email ?? copy.authors.labels.unknownUser;
  const presetAuthorId = searchParams.get("authorId")?.trim() ?? "";

  useEffect(() => {
    primaryAuthorIdRef.current = primaryBundle?.author._id ?? "";
  }, [primaryBundle?.author._id]);

  useEffect(() => {
    if (authState !== "unauthorized" && authState !== "forbidden") return;

    const timeoutId = window.setTimeout(() => {
      router.replace("/admin");
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState, router]);

  const loadAuthorBundle = async (authorId: string) => {
    const { author, publications } = await getAdminAuthorBundleCached(authorId);

    return { author, publicationsCount: publications.length };
  };

  useEffect(() => {
    if (
      authState !== "ready" ||
      !presetAuthorId ||
      loadedPresetAuthorIdRef.current === presetAuthorId
    ) {
      return;
    }

    loadedPresetAuthorIdRef.current = presetAuthorId;
    const selectionVersion = primarySelectionVersionRef.current;
    setBundleLoading(true);
    loadAuthorBundle(presetAuthorId)
      .then((bundle) => {
        if (primarySelectionVersionRef.current !== selectionVersion) return;
        setPrimaryBundle(bundle);
      })
      .catch(() => {
        if (primarySelectionVersionRef.current !== selectionVersion) return;
        setFeedback({ type: "error", text: workflowCopy.merge.failed });
      })
      .finally(() => {
        if (primarySelectionVersionRef.current !== selectionVersion) return;
        setBundleLoading(false);
      });
  }, [authState, presetAuthorId, workflowCopy.merge.failed]);

  const runSearch = async (value = query) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResultsError(workflowCopy.common.searchHint);
      return;
    }

    hydratedQueryRef.current = trimmed;
    setResultsLoading(true);
    setResultsError(null);
    setFeedback(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("q", trimmed);
    if (primaryBundle?.author._id ?? presetAuthorId) {
      params.set("authorId", primaryBundle?.author._id ?? presetAuthorId);
    }
    router.replace(`${pathname}?${params.toString()}`);

    try {
      const response = await searchAdminAuthorsCached(trimmed, 25);
      setResults(dedupeAuthorResults(response.items ?? []));
    } catch (error) {
      setResultsError(getErrorMessage(error, copy.authors.messages.searchFailed));
      setResults([]);
    } finally {
      setResultsLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== "ready" || presetQuery.length < 2) return;
    if (hydratedQueryRef.current === presetQuery) return;
    hydratedQueryRef.current = presetQuery;
    setQuery(presetQuery);
    void runSearch(presetQuery);
  }, [authState, presetQuery]);

  const assignBundle = async (authorId: string, target: "primary" | "secondary") => {
    if (target === "primary") {
      primarySelectionVersionRef.current += 1;
    }

    setBundleLoading(true);
    setFeedback(null);
    if (target === "primary") {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) {
        params.set("q", query.trim());
      }
      params.set("authorId", authorId);
      router.replace(`${pathname}?${params.toString()}`);
    }

    try {
      const bundle = await loadAuthorBundle(authorId);
      if (target === "primary") {
        setPrimaryBundle(bundle);
      } else {
        setSecondaryBundle(bundle);
      }
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.merge.failed) });
    } finally {
      setBundleLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!primaryBundle || !secondaryBundle) return;

    setMergeLoading(true);
    setFeedback(null);

    try {
      const response = await api.admin.mergeAuthors({
        primaryAuthorId: primaryBundle.author._id,
        secondaryAuthorId: secondaryBundle.author._id,
      });
      invalidateAdminAuthorBundle(primaryBundle.author._id);
      invalidateAdminAuthorBundle(secondaryBundle.author._id);
      invalidateAdminAuthorSearches();
      const nextPrimary = await getAdminAuthorBundleCached(response.primaryAuthorId, {
        force: true,
      }).then(({ author, publications }) => ({
        author,
        publicationsCount: publications.length,
      }));
      setPrimaryBundle(nextPrimary);
      setSecondaryBundle(null);
      setReviewOpen(false);
      setFeedback({
        type: "success",
        text: workflowCopy.merge.success
          .replace("{name}", response.author.fullName)
          .replace("{count}", numberFormatter.format(response.movedPublicationCount)),
      });
      if (query.trim().length >= 2) {
        await runSearch();
      }
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.merge.failed) });
    } finally {
      setMergeLoading(false);
    }
  };

  const canReview = Boolean(
    primaryBundle &&
      secondaryBundle &&
      primaryBundle.author._id !== secondaryBundle.author._id,
  );

  if (authState === "loading") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={workflowCopy.common.backToAdmin}
            brandName={adminBrandName}
            brandSubtitle={workflowCopy.common.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card">
            <ShieldCheck size={20} />
            <div>{workflowCopy.common.loadingSession}</div>
          </section>
        </div>
      </main>
    );
  }

  if (authState === "unauthorized") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={workflowCopy.common.backToAdmin}
            brandName={adminBrandName}
            brandSubtitle={workflowCopy.common.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card is-warning">
            <ShieldAlert size={20} />
            <div>
              <strong>{workflowCopy.common.unauthorizedTitle}</strong>
              <p>{workflowCopy.common.unauthorizedBody}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (authState === "forbidden") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/admin"
            backLabel={workflowCopy.common.backToAdmin}
            brandName={adminBrandName}
            brandSubtitle={workflowCopy.common.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card is-danger">
            <ShieldX size={20} />
            <div>
              <strong>{workflowCopy.common.forbiddenTitle}</strong>
              <p>{currentUser?.email ?? workflowCopy.common.unknownUser}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="authors-page admin-page">
      <div className="authors-shell">
        <AuthorPageTopbar
          backHref="/admin"
          backLabel={workflowCopy.common.backToAdmin}
          brandName={adminBrandName}
          brandSubtitle={workflowCopy.common.topbarSubtitle}
          theme={theme}
          themeToggleLabel={t("theme.toggle")}
          onToggleTheme={toggle}
        />
        <AdminWorkspaceNav />
        <AdminOperationNav authorId={primaryBundle?.author._id ?? presetAuthorId} query={query} />

        {feedback ? (
          <section className={feedback.type === "success" ? "admin-feedback-card is-success" : "admin-feedback-card is-error"}>
            {feedback.text}
          </section>
        ) : null}

        <section className="admin-search-card">
          <div className="admin-search-head">
            <div>
              <h2>{workflowCopy.common.searchTitle}</h2>
              <p>{workflowCopy.common.searchSubtitle}</p>
            </div>
            <div className="admin-search-note">{workflowCopy.common.searchHint}</div>
          </div>
          <form
            className="admin-searchbar"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <label className="authors-search-input">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={workflowCopy.common.searchPlaceholder}
              />
            </label>
            <button
              type="submit"
              className="admin-primary-button admin-search-submit"
              disabled={resultsLoading || query.trim().length < 2}
            >
              {resultsLoading ? workflowCopy.common.searchActionLoading : workflowCopy.common.searchAction}
            </button>
          </form>
          {resultsError ? <p className="authors-error">{resultsError}</p> : null}
        </section>

        <section className="admin-grid">
          <section className="admin-panel">
            <div className="admin-panel-head">
              <div>
                <h2>{copy.authors.resultsTitle}</h2>
                <p className="admin-panel-head-copy">{workflowCopy.common.searchEmpty}</p>
              </div>
              <span>{workflowCopy.common.records.replace("{count}", numberFormatter.format(results.length))}</span>
            </div>
            <AdminAuthorResultsList
              authors={results}
              institutionFallback={workflowCopy.common.unknownInstitution}
              emptyText={workflowCopy.common.searchEmpty}
              labels={{
                id: copy.authors.labels.id,
                moreProfiles: copy.authors.labels.moreProfiles,
              }}
              renderActions={(author) => (
                <>
                  <button
                    type="button"
                    className="admin-compact-button"
                    onClick={() => void assignBundle(author._id, "primary")}
                    disabled={bundleLoading}
                  >
                    {workflowCopy.merge.assignPrimary}
                  </button>
                  <button
                    type="button"
                    className="admin-compact-button"
                    onClick={() => void assignBundle(author._id, "secondary")}
                    disabled={bundleLoading}
                  >
                    {workflowCopy.merge.assignSecondary}
                  </button>
                </>
              )}
            />
          </section>

          <section className="admin-panel admin-panel-wide admin-panel-compare">
            <div className="admin-panel-head">
              <div>
                <h2>{workflowCopy.merge.compareTitle}</h2>
                <p className="admin-panel-head-copy">{workflowCopy.merge.compareSubtitle}</p>
              </div>
              <button
                type="button"
                className="admin-secondary-button admin-secondary-button-quiet"
                onClick={() => {
                  if (query.trim().length >= 2) {
                    void runSearch();
                  }
                }}
                disabled={resultsLoading}
              >
                <RefreshCcw size={15} />
                {copy.logs.refreshAction}
              </button>
            </div>
            <div className="admin-compare-stage">
              <div className="admin-comparison-grid admin-comparison-grid-merge">
                <AdminAuthorSnapshotCard
                  title={workflowCopy.common.primaryAuthor}
                  emptyLabel={workflowCopy.common.noSelection}
                  author={primaryBundle?.author}
                  publicationCount={primaryBundle?.publicationsCount ?? 0}
                  institutionFallback={workflowCopy.common.unknownInstitution}
                  labels={{
                    id: copy.authors.labels.id,
                    sourceProfiles: workflowCopy.common.sourceProfiles,
                    publications: workflowCopy.common.publications,
                    aliases: workflowCopy.common.aliases,
                    selected: workflowCopy.common.selected,
                  }}
                  subtitle={workflowCopy.merge.primarySummary}
                />
                <div className="admin-compare-arrow admin-compare-arrow-merge" aria-hidden="true">
                  <span className="admin-compare-arrow-icon">
                    <ArrowLeft size={20} />
                  </span>
                  <span className="admin-compare-arrow-label">{workflowCopy.merge.compareFlowLabel}</span>
                </div>
                <AdminAuthorSnapshotCard
                  title={workflowCopy.common.secondaryAuthor}
                  emptyLabel={workflowCopy.common.noSelection}
                  author={secondaryBundle?.author}
                  publicationCount={secondaryBundle?.publicationsCount ?? 0}
                  institutionFallback={workflowCopy.common.unknownInstitution}
                  labels={{
                    id: copy.authors.labels.id,
                    sourceProfiles: workflowCopy.common.sourceProfiles,
                    publications: workflowCopy.common.publications,
                    aliases: workflowCopy.common.aliases,
                    selected: workflowCopy.common.selected,
                  }}
                  subtitle={workflowCopy.merge.secondarySummary}
                />
              </div>
              <div className="admin-compare-footer">
                <p className="admin-compare-footnote">
                  {canReview ? workflowCopy.merge.reviewHintReady : workflowCopy.merge.reviewHintIdle}
                </p>
                <button
                  type="button"
                  className="admin-primary-button admin-compare-cta"
                  onClick={() => setReviewOpen(true)}
                  disabled={!canReview || bundleLoading}
                >
                  <GitMerge size={15} />
                  {workflowCopy.common.reviewAction}
                </button>
              </div>
            </div>
          </section>
        </section>

        <AdminOperationModal
          open={reviewOpen}
          title={workflowCopy.merge.reviewTitle}
          subtitle={workflowCopy.merge.reviewSubtitle}
          cancelLabel={workflowCopy.common.cancelAction}
          confirmLabel={workflowCopy.merge.confirmLabel}
          confirmLoadingLabel={workflowCopy.merge.confirmLoading}
          loading={mergeLoading}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void handleMerge()}
        >
          <div className="admin-modal-summary-grid">
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.primaryAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={primaryBundle?.author}
              publicationCount={primaryBundle?.publicationsCount ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
              }}
              subtitle={workflowCopy.merge.primarySummary}
            />
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.secondaryAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={secondaryBundle?.author}
              publicationCount={secondaryBundle?.publicationsCount ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
              }}
              subtitle={workflowCopy.merge.secondarySummary}
            />
          </div>
        </AdminOperationModal>
      </div>
    </main>
  );
}
