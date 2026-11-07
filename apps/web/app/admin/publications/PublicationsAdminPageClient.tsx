"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { api } from "@/api";
import type { AdminCatalogAuthor, AdminCatalogPublication } from "@/api";
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
  formatPublicationMeta,
  getAuthorLocation,
  getErrorMessage,
  getPublicationKey,
  getPrimaryInstitution,
  getShortId,
} from "../adminUtils";
import { AdminAuthorResultsList } from "../components/AdminAuthorResultsList";
import { AdminAuthorSnapshotCard } from "../components/AdminAuthorSnapshotCard";
import { AdminOperationModal } from "../components/AdminOperationModal";
import { AdminOperationNav } from "../components/AdminOperationNav";
import { AdminWorkspaceNav } from "../components/AdminWorkspaceNav";
import { useAdminSession } from "../useAdminSession";

type SourceBundle = {
  author: AdminCatalogAuthor;
  publications: AdminCatalogPublication[];
};

type TargetBundle = {
  author: AdminCatalogAuthor;
  publicationsCount: number;
};

export default function PublicationsAdminPageClient() {
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

  const [sourceBundle, setSourceBundle] = useState<SourceBundle | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const [targetQuery, setTargetQuery] = useState("");
  const [targetResults, setTargetResults] = useState<AdminCatalogAuthor[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetBundle, setTargetBundle] = useState<TargetBundle | null>(null);

  const [selectedPublicationIds, setSelectedPublicationIds] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const hydratedQueryRef = useRef("");
  const sourceAuthorIdRef = useRef("");

  const adminBrandName = `${t("brand.name")} Admin`;
  const presetAuthorId = searchParams.get("authorId")?.trim() ?? "";
  const currentUserLabel =
    currentUser?.fullName ?? currentUser?.email ?? copy.authors.labels.unknownUser;

  const selectedPublications = useMemo(() => {
    return (sourceBundle?.publications ?? []).filter((publication) =>
      selectedPublicationIds.includes(getPublicationKey(publication)),
    );
  }, [selectedPublicationIds, sourceBundle]);

  useEffect(() => {
    sourceAuthorIdRef.current = sourceBundle?.author._id ?? "";
  }, [sourceBundle?.author._id]);

  useEffect(() => {
    if (authState !== "unauthorized" && authState !== "forbidden") return;

    const timeoutId = window.setTimeout(() => {
      router.replace("/admin");
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState, router]);

  const loadSourceBundle = async (authorId: string) => {
    const { author, publications } = await getAdminAuthorBundleCached(authorId);
    return { author, publications };
  };

  const loadTargetBundle = async (authorId: string) => {
    const { author, publications } = await getAdminAuthorBundleCached(authorId);
    return { author, publicationsCount: publications.length };
  };

  useEffect(() => {
    if (authState !== "ready" || !presetAuthorId || sourceAuthorIdRef.current === presetAuthorId) return;

    setSourceLoading(true);
    loadSourceBundle(presetAuthorId)
      .then((bundle) => {
        setSourceBundle(bundle);
      })
      .catch((error) => {
        setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.publications.failed) });
      })
      .finally(() => {
        setSourceLoading(false);
      });
  }, [authState, presetAuthorId, workflowCopy.publications.failed]);

  const runSearch = async (value = query) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResultsError(workflowCopy.common.searchHint);
      return;
    }

    hydratedQueryRef.current = trimmed;
    setResultsLoading(true);
    setResultsError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("q", trimmed);
    if (sourceBundle?.author._id ?? presetAuthorId) {
      params.set("authorId", sourceBundle?.author._id ?? presetAuthorId);
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

  const runTargetSearch = async () => {
    const trimmed = targetQuery.trim();
    if (trimmed.length < 2) {
      setTargetError(workflowCopy.common.searchHint);
      return;
    }

    setTargetLoading(true);
    setTargetError(null);

    try {
      const response = await searchAdminAuthorsCached(trimmed, 25);
      const items = dedupeAuthorResults(response.items ?? []).filter(
        (author) => author._id !== sourceBundle?.author._id,
      );
      setTargetResults(items);
    } catch (error) {
      setTargetError(getErrorMessage(error, copy.authors.messages.searchFailed));
      setTargetResults([]);
    } finally {
      setTargetLoading(false);
    }
  };

  const assignSourceAuthor = async (authorId: string) => {
    setSourceLoading(true);
    setFeedback(null);
    setSelectedPublicationIds([]);
    const params = new URLSearchParams(searchParams.toString());
    if (query.trim()) {
      params.set("q", query.trim());
    }
    params.set("authorId", authorId);
    router.replace(`${pathname}?${params.toString()}`);
    try {
      const bundle = await loadSourceBundle(authorId);
      setSourceBundle(bundle);
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.publications.failed) });
    } finally {
      setSourceLoading(false);
    }
  };

  const assignTargetAuthor = async (authorId: string) => {
    setTargetLoading(true);
    setFeedback(null);
    try {
      const bundle = await loadTargetBundle(authorId);
      setTargetBundle(bundle);
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.publications.failed) });
    } finally {
      setTargetLoading(false);
    }
  };

  const handleMove = async () => {
    if (!sourceBundle || !targetBundle || selectedPublicationIds.length === 0) return;

    setMoveLoading(true);
    setFeedback(null);

    try {
      const response = await api.admin.reassignPublications({
        fromAuthorId: sourceBundle.author._id,
        toAuthorId: targetBundle.author._id,
        publicationIds: selectedPublicationIds,
      });

      invalidateAdminAuthorBundle(sourceBundle.author._id);
      invalidateAdminAuthorBundle(targetBundle.author._id);
      invalidateAdminAuthorSearches();
      const nextSource = await getAdminAuthorBundleCached(response.fromAuthor._id, {
        force: true,
      }).then(({ author, publications }) => ({ author, publications }));
      const nextTarget = await getAdminAuthorBundleCached(response.toAuthor._id, {
        force: true,
      }).then(({ author, publications }) => ({
        author,
        publicationsCount: publications.length,
      }));
      setSourceBundle(nextSource);
      setTargetBundle(nextTarget);
      setSelectedPublicationIds([]);
      setReviewOpen(false);
      setFeedback({
        type: "success",
        text: workflowCopy.publications.success.replace(
          "{count}",
          numberFormatter.format(response.movedPublicationCount),
        ),
      });
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.publications.failed) });
    } finally {
      setMoveLoading(false);
    }
  };

  const canReview = Boolean(sourceBundle && targetBundle && selectedPublicationIds.length > 0);

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
        <AdminOperationNav authorId={sourceBundle?.author._id ?? presetAuthorId} query={query} />

        <section className="admin-status-card is-success">
          <ShieldCheck size={18} />
          <div>
            <strong>{workflowCopy.publications.verifiedTitle}</strong>
            <p>
              {currentUserLabel} · {workflowCopy.publications.verifiedBody}
            </p>
          </div>
        </section>

        <section className="admin-overview-card">
          <div className="admin-overview-copy">
            <p className="admin-eyebrow">{workflowCopy.publications.heroEyebrow}</p>
            <h1>{workflowCopy.publications.heroTitle}</h1>
            <p>{workflowCopy.publications.heroSubtitle}</p>
            <div className="admin-overview-pills">
              <span className="admin-pill">{workflowCopy.publications.selectedPublicationsTitle}</span>
              <span className="admin-mini-pill">
                {selectedPublications.length > 0
                  ? numberFormatter.format(selectedPublications.length)
                  : workflowCopy.common.searchHint}
              </span>
            </div>
          </div>
          <div className="admin-overview-stats">
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.sourceAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={sourceBundle?.author}
              publicationCount={sourceBundle?.publications.length ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
                selected: workflowCopy.common.selected,
              }}
              selected
            />
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.targetAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={targetBundle?.author}
              publicationCount={targetBundle?.publicationsCount ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
                selected: workflowCopy.common.selected,
              }}
              selected
            />
          </div>
        </section>

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
                <button
                  type="button"
                  className="admin-compact-button"
                  onClick={() => void assignSourceAuthor(author._id)}
                  disabled={sourceLoading}
                >
                  {workflowCopy.common.sourceAuthor}
                </button>
              )}
            />
          </section>

          <section className="admin-panel admin-panel-wide">
            <div className="admin-panel-head admin-panel-head-transfer">
              <div>
                <h2>{workflowCopy.publications.sourceSummaryTitle}</h2>
                <p className="admin-panel-head-copy">{workflowCopy.publications.selectedPublicationsSubtitle}</p>
              </div>
              <div className="admin-transfer-summary">
                <span className="admin-pill">
                  {workflowCopy.publications.selectedPublicationsTitle} ·{" "}
                  {numberFormatter.format(selectedPublications.length)}
                </span>
                <span className={targetBundle ? "admin-mini-pill is-success" : "admin-mini-pill"}>
                  {targetBundle?.author.fullName ?? workflowCopy.common.targetAuthor}
                </span>
              </div>
            </div>

            <div className="admin-two-column admin-two-column-transfer">
              <div className="admin-detail-card admin-transfer-stage">
                <div className="admin-section-head">
                  <div>
                    <h3>{workflowCopy.publications.selectedPublicationsTitle}</h3>
                    <p className="admin-panel-head-copy">{workflowCopy.publications.selectedPublicationsSubtitle}</p>
                  </div>
                  <span>{numberFormatter.format(selectedPublications.length)}</span>
                </div>
                <div className="admin-transfer-stage-summary">
                  <div className="admin-transfer-stage-chip">
                    <span>{workflowCopy.common.sourceAuthor}</span>
                    <strong>{sourceBundle?.author.fullName ?? workflowCopy.common.noSelection}</strong>
                  </div>
                  <div className="admin-transfer-stage-chip">
                    <span>{workflowCopy.common.publications}</span>
                    <strong>{numberFormatter.format(sourceBundle?.publications.length ?? 0)}</strong>
                  </div>
                </div>
                <div className="admin-checklist admin-checklist-publications">
                  {!sourceBundle ? (
                    <div className="admin-empty-card">{workflowCopy.common.noSelection}</div>
                  ) : sourceBundle.publications.length === 0 ? (
                    <div className="admin-empty-card">{workflowCopy.publications.publicationsEmpty}</div>
                  ) : (
                    sourceBundle.publications.map((publication) => {
                      const checked = selectedPublicationIds.includes(publication._id);
                      return (
                        <label
                          key={publication._id}
                          className={
                            checked
                              ? "admin-checklist-item admin-transfer-publication is-selected"
                              : "admin-checklist-item admin-transfer-publication"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedPublicationIds((current) =>
                                event.target.checked
                                  ? [...current, publication._id]
                                  : current.filter((item) => item !== publication._id),
                              );
                            }}
                          />
                          <div className="admin-transfer-publication-copy">
                            <strong>{publication.title}</strong>
                            <p>{formatPublicationMeta(publication) || copy.authors.publications.metadataMissing}</p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="admin-action-stack admin-transfer-sidebar">
                <div className="admin-detail-card admin-transfer-stage admin-transfer-target-stage">
                  <div className="admin-section-head">
                    <div>
                      <h3>{workflowCopy.publications.targetSearchTitle}</h3>
                      <p className="admin-panel-head-copy">{workflowCopy.publications.targetSearchSubtitle}</p>
                    </div>
                    <span>
                      {targetBundle ? workflowCopy.common.selected : workflowCopy.common.noSelection}
                    </span>
                  </div>
                  <form
                    className="admin-searchbar"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runTargetSearch();
                    }}
                  >
                    <label className="authors-search-input">
                      <Search size={18} />
                      <input
                        value={targetQuery}
                        onChange={(event) => setTargetQuery(event.target.value)}
                        placeholder={workflowCopy.publications.targetSearchPlaceholder}
                      />
                    </label>
                    <button
                      type="submit"
                      className="admin-primary-button admin-search-submit"
                      disabled={targetLoading || targetQuery.trim().length < 2}
                    >
                      {targetLoading ? workflowCopy.common.searchActionLoading : workflowCopy.common.searchAction}
                    </button>
                  </form>
                  {targetError ? <p className="authors-error">{targetError}</p> : null}
                  {targetBundle ? (
                    <div className="admin-transfer-target-summary">
                      <div className="admin-transfer-target-summary-head">
                        <p className="admin-eyebrow">{workflowCopy.common.targetAuthor}</p>
                        <span className="admin-mini-pill is-success">
                          {workflowCopy.common.selected}
                        </span>
                      </div>
                      <strong>{targetBundle.author.fullName}</strong>
                      <span>
                        {getPrimaryInstitution(
                          targetBundle.author,
                          workflowCopy.common.unknownInstitution,
                        )}
                      </span>
                      {getAuthorLocation(targetBundle.author) ? (
                        <span>{getAuthorLocation(targetBundle.author)}</span>
                      ) : null}
                      <div className="admin-result-preview admin-result-preview-tight">
                        <span>
                          {copy.authors.labels.id} · {getShortId(targetBundle.author._id)}
                        </span>
                        <span>
                          {numberFormatter.format(targetBundle.publicationsCount)}{" "}
                          {workflowCopy.common.publications.toLowerCase()}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-empty-card admin-empty-card-soft">
                      {workflowCopy.publications.targetSearchEmpty}
                    </div>
                  )}
                  {targetResults.length > 0 || targetQuery.trim().length >= 2 ? (
                    <AdminAuthorResultsList
                      authors={targetResults}
                      className="admin-results-list-compact"
                      selectedId={targetBundle?.author._id}
                      institutionFallback={workflowCopy.common.unknownInstitution}
                      emptyText={workflowCopy.publications.targetSearchEmpty}
                      labels={{
                        id: copy.authors.labels.id,
                        moreProfiles: copy.authors.labels.moreProfiles,
                      }}
                      renderActions={(author) => (
                        <button
                          type="button"
                          className="admin-compact-button"
                          onClick={() => void assignTargetAuthor(author._id)}
                          disabled={targetLoading}
                        >
                          {workflowCopy.common.targetAuthor}
                        </button>
                      )}
                    />
                  ) : null}
                </div>

                <div className="admin-detail-card admin-transfer-action-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{workflowCopy.common.reviewAction}</h3>
                      <p className="admin-panel-head-copy">{workflowCopy.publications.reviewSubtitle}</p>
                    </div>
                  </div>
                  <div className="admin-transfer-stage-summary">
                    <div className="admin-transfer-stage-chip">
                      <span>{workflowCopy.publications.selectedPublicationsTitle}</span>
                      <strong>{numberFormatter.format(selectedPublications.length)}</strong>
                    </div>
                    <div className="admin-transfer-stage-chip">
                      <span>{workflowCopy.common.targetAuthor}</span>
                      <strong>{targetBundle?.author.fullName ?? workflowCopy.common.noSelection}</strong>
                    </div>
                  </div>
                  <div className="admin-detail-actions admin-detail-actions-stacked">
                    <button
                      type="button"
                      className="admin-primary-button"
                      onClick={() => setReviewOpen(true)}
                      disabled={!canReview || sourceLoading || targetLoading}
                    >
                      <ArrowRightLeft size={15} />
                      {workflowCopy.common.reviewAction}
                    </button>
                    {sourceBundle ? (
                      <button
                        type="button"
                        className="admin-secondary-button"
                        onClick={() => void assignSourceAuthor(sourceBundle.author._id)}
                      >
                        <RefreshCcw size={15} />
                        {copy.authors.quickActionsRefresh}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>

        <AdminOperationModal
          open={reviewOpen}
          title={workflowCopy.publications.reviewTitle}
          subtitle={workflowCopy.publications.reviewSubtitle}
          cancelLabel={workflowCopy.common.cancelAction}
          confirmLabel={workflowCopy.publications.confirm}
          confirmLoadingLabel={workflowCopy.publications.confirmLoading}
          loading={moveLoading}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void handleMove()}
        >
          <div className="admin-modal-summary-grid">
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.sourceAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={sourceBundle?.author}
              publicationCount={sourceBundle?.publications.length ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
              }}
            />
            <AdminAuthorSnapshotCard
              title={workflowCopy.common.targetAuthor}
              emptyLabel={workflowCopy.common.noSelection}
              author={targetBundle?.author}
              publicationCount={targetBundle?.publicationsCount ?? 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
              }}
            />
          </div>
          <div className="admin-selection-summary">
            <div className="admin-selection-summary-block">
              <strong>{workflowCopy.publications.selectedPublicationsTitle}</strong>
              <div className="admin-result-preview">
                {selectedPublications.map((publication) => (
                  <span key={publication._id}>{publication.title}</span>
                ))}
              </div>
            </div>
          </div>
        </AdminOperationModal>
      </div>
    </main>
  );
}
