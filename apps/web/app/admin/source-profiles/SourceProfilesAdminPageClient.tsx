"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  RefreshCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
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
  formatProfileSyncDate,
  formatSourceProfileLabel,
  getErrorMessage,
  getPublicationKey,
  getSourceProfileKey,
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

type Mode = "detach" | "remove";

export default function SourceProfilesAdminPageClient() {
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

  const [mode, setMode] = useState<Mode>("detach");
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [newAuthorName, setNewAuthorName] = useState("");

  const [selectedProfileKeys, setSelectedProfileKeys] = useState<string[]>([]);
  const [selectedPublicationIds, setSelectedPublicationIds] = useState<string[]>([]);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const hydratedQueryRef = useRef("");
  const sourceAuthorIdRef = useRef("");

  const adminBrandName = `${t("brand.name")} Admin`;
  const presetAuthorId = searchParams.get("authorId")?.trim() ?? "";
  const currentUserLabel =
    currentUser?.fullName ?? currentUser?.email ?? copy.authors.labels.unknownUser;

  const selectedProfiles = useMemo(() => {
    return (sourceBundle?.author.sourceProfiles ?? []).filter((profile) =>
      selectedProfileKeys.includes(getSourceProfileKey(profile)),
    );
  }, [selectedProfileKeys, sourceBundle]);

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
        setNewAuthorName(bundle.author.fullName);
      })
      .catch((error) => {
        setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.sourceProfiles.detachFailed) });
      })
      .finally(() => {
        setSourceLoading(false);
      });
  }, [authState, presetAuthorId, sourceBundle?.author._id, workflowCopy.sourceProfiles.detachFailed]);

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
    setTargetBundle(null);
    setSelectedProfileKeys([]);
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
      setNewAuthorName(bundle.author.fullName);
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.sourceProfiles.detachFailed) });
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
      setFeedback({ type: "error", text: getErrorMessage(error, workflowCopy.sourceProfiles.detachFailed) });
    } finally {
      setTargetLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!sourceBundle || selectedProfiles.length === 0) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      if (mode === "detach") {
        const response = await api.admin.detachSourceProfiles(sourceBundle.author._id, {
          sourceProfiles: selectedProfiles.map((profile) => ({
            platform: profile.platform,
            platformKey: profile.platformKey,
            externalAuthorId: profile.externalAuthorId,
            profileUrl: profile.profileUrl,
            score: profile.score,
            lastSyncedAt: profile.lastSyncedAt,
          })),
          targetAuthorId: targetMode === "existing" ? targetBundle?.author._id : undefined,
          newAuthor:
            targetMode === "new"
              ? {
                  fullName: newAuthorName.trim(),
                }
              : undefined,
          publicationIds: selectedPublicationIds,
        });

        invalidateAdminAuthorBundle(sourceBundle.author._id);
        invalidateAdminAuthorBundle(targetBundle?.author._id);
        invalidateAdminAuthorBundle(response.targetAuthor._id);
        invalidateAdminAuthorSearches();
        const nextSource = await getAdminAuthorBundleCached(response.sourceAuthor._id, {
          force: true,
        }).then(({ author, publications }) => ({ author, publications }));
        setSourceBundle(nextSource);
        setTargetBundle(
          targetMode === "existing"
            ? await getAdminAuthorBundleCached(response.targetAuthor._id, {
                force: true,
              }).then(({ author, publications }) => ({
                author,
                publicationsCount: publications.length,
              }))
            : null,
        );
        setSelectedProfileKeys([]);
        setSelectedPublicationIds([]);
        setReviewOpen(false);
        setFeedback({
          type: "success",
          text: workflowCopy.sourceProfiles.detachSuccess
            .replace("{count}", numberFormatter.format(response.detachedSourceProfiles.length))
            .replace("{moved}", numberFormatter.format(response.movedPublicationCount)),
        });
      } else {
        const response = await api.admin.removeSourceProfiles(sourceBundle.author._id, {
          sourceProfiles: selectedProfiles.map((profile) => ({
            platform: profile.platform,
            platformKey: profile.platformKey,
            externalAuthorId: profile.externalAuthorId,
            profileUrl: profile.profileUrl,
            score: profile.score,
            lastSyncedAt: profile.lastSyncedAt,
          })),
          publicationIds: selectedPublicationIds,
        });

        invalidateAdminAuthorBundle(sourceBundle.author._id);
        invalidateAdminAuthorSearches();
        const nextSource = await getAdminAuthorBundleCached(response.sourceAuthor._id, {
          force: true,
        }).then(({ author, publications }) => ({ author, publications }));
        setSourceBundle(nextSource);
        setSelectedProfileKeys([]);
        setSelectedPublicationIds([]);
        setReviewOpen(false);
        const suffix =
          response.updatedPublicationCount > 0
            ? workflowCopy.sourceProfiles.removePublicationSuffix.replace(
                "{count}",
                numberFormatter.format(response.updatedPublicationCount),
              )
            : "";
        setFeedback({
          type: "success",
          text: workflowCopy.sourceProfiles.removeSuccess
            .replace("{count}", numberFormatter.format(response.removedSourceProfiles.length))
            .replace("{suffix}", suffix),
        });
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: getErrorMessage(
          error,
          mode === "detach"
            ? workflowCopy.sourceProfiles.detachFailed
            : workflowCopy.sourceProfiles.removeFailed,
        ),
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getReviewBlockReason = (nextMode: Mode) => {
    if (!sourceBundle) return workflowCopy.sourceProfiles.reviewNeedsSource;
    if (selectedProfiles.length === 0) return workflowCopy.sourceProfiles.reviewNeedsProfiles;
    if (nextMode === "remove") return null;
    if (targetMode === "new") {
      return newAuthorName.trim().length > 0
        ? null
        : workflowCopy.sourceProfiles.reviewNeedsNewAuthor;
    }

    return targetBundle ? null : workflowCopy.sourceProfiles.reviewNeedsTarget;
  };

  const handleReviewIntent = (nextMode: Mode) => {
    setMode(nextMode);
    const blockReason = getReviewBlockReason(nextMode);
    if (blockReason) {
      setReviewOpen(false);
      setFeedback({ type: "error", text: blockReason });
      return;
    }

    setFeedback(null);
    setReviewOpen(true);
  };

  const reviewHint =
    getReviewBlockReason(mode) ??
    (mode === "detach"
      ? workflowCopy.sourceProfiles.reviewHintDetachReady
      : workflowCopy.sourceProfiles.reviewHintRemoveReady);

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
            <strong>{workflowCopy.sourceProfiles.verifiedTitle}</strong>
            <p>
              {currentUserLabel} · {workflowCopy.sourceProfiles.verifiedBody}
            </p>
          </div>
        </section>

        <section className="admin-overview-card">
          <div className="admin-overview-copy">
            <p className="admin-eyebrow">{workflowCopy.sourceProfiles.heroEyebrow}</p>
            <h1>{workflowCopy.sourceProfiles.heroTitle}</h1>
            <p>{workflowCopy.sourceProfiles.heroSubtitle}</p>
            <div className="admin-overview-pills">
              <span className="admin-pill">
                {mode === "detach"
                  ? workflowCopy.sourceProfiles.modeDetach
                  : workflowCopy.sourceProfiles.modeRemove}
              </span>
              <span className="admin-mini-pill">
                {sourceBundle?.author.fullName ?? workflowCopy.common.searchHint}
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
              emptyLabel={
                targetMode === "new"
                  ? newAuthorName.trim() || workflowCopy.common.newAuthor
                  : workflowCopy.common.noSelection
              }
              author={targetMode === "existing" ? targetBundle?.author : null}
              publicationCount={targetMode === "existing" ? targetBundle?.publicationsCount ?? 0 : 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
                selected: workflowCopy.common.selected,
              }}
              subtitle={
                targetMode === "new"
                  ? workflowCopy.common.newAuthor
                  : workflowCopy.common.chooseExistingAuthor
              }
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
            <div className="admin-panel-head">
              <div>
                <h2>{workflowCopy.sourceProfiles.sourceSummaryTitle}</h2>
                <p className="admin-panel-head-copy">{workflowCopy.sourceProfiles.sourceSummarySubtitle}</p>
              </div>
              <div className="admin-toggle-group">
                <button
                  type="button"
                  className={mode === "detach" ? "admin-toggle-button is-active" : "admin-toggle-button"}
                  onClick={() => handleReviewIntent("detach")}
                >
                  {workflowCopy.sourceProfiles.modeDetach}
                </button>
                <button
                  type="button"
                  className={mode === "remove" ? "admin-toggle-button is-active" : "admin-toggle-button"}
                  onClick={() => handleReviewIntent("remove")}
                >
                  {workflowCopy.sourceProfiles.modeRemove}
                </button>
              </div>
            </div>

            <div className="admin-two-column">
              <div className="admin-detail-card">
                <div className="admin-section-head">
                  <div>
                    <h3>{workflowCopy.sourceProfiles.selectedProfilesTitle}</h3>
                    <p className="admin-panel-head-copy">{workflowCopy.sourceProfiles.selectedProfilesSubtitle}</p>
                  </div>
                  <span>{numberFormatter.format(selectedProfiles.length)}</span>
                </div>
                <div className="admin-checklist">
                  {!sourceBundle ? (
                    <div className="admin-empty-card">{workflowCopy.common.noSelection}</div>
                  ) : (sourceBundle.author.sourceProfiles ?? []).length === 0 ? (
                    <div className="admin-empty-card">{workflowCopy.sourceProfiles.sourceProfilesEmpty}</div>
                  ) : (
                    (sourceBundle.author.sourceProfiles ?? []).map((profile) => {
                      const key = getSourceProfileKey(profile);
                      const checked = selectedProfileKeys.includes(key);
                      return (
                        <label key={key} className={checked ? "admin-checklist-item is-selected" : "admin-checklist-item"}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedProfileKeys((current) =>
                                event.target.checked
                                  ? [...current, key]
                                  : current.filter((item) => item !== key),
                              );
                            }}
                          />
                          <div>
                            <strong>{formatSourceProfileLabel(profile)}</strong>
                            <p>{profile.externalAuthorId}</p>
                            <div className="admin-inline-list admin-inline-list-muted">
                              {profile.score ? <span>Skor {profile.score}</span> : null}
                              {formatProfileSyncDate(locale, profile.lastSyncedAt) ? (
                                <span>
                                  {formatProfileSyncDate(locale, profile.lastSyncedAt)}
                                </span>
                              ) : null}
                            </div>
                            {profile.profileUrl ? (
                              <Link href={profile.profileUrl} target="_blank" rel="noreferrer" className="admin-inline-link">
                                {workflowCopy.common.openProfile}
                              </Link>
                            ) : null}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="admin-action-stack">
                <div className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{workflowCopy.sourceProfiles.selectedPublicationsTitle}</h3>
                      <p className="admin-panel-head-copy">{workflowCopy.sourceProfiles.selectedPublicationsSubtitle}</p>
                    </div>
                    <span>{numberFormatter.format(selectedPublications.length)}</span>
                  </div>
                  <div className="admin-checklist">
                    {!sourceBundle ? (
                      <div className="admin-empty-card">{workflowCopy.common.noSelection}</div>
                    ) : sourceBundle.publications.length === 0 ? (
                      <div className="admin-empty-card">{workflowCopy.sourceProfiles.publicationsEmpty}</div>
                    ) : (
                      sourceBundle.publications.map((publication) => {
                        const checked = selectedPublicationIds.includes(publication._id);
                        return (
                          <label
                            key={publication._id}
                            className={checked ? "admin-checklist-item is-selected" : "admin-checklist-item"}
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
                            <div>
                              <strong>{publication.title}</strong>
                              <p>{formatPublicationMeta(publication) || copy.authors.publications.metadataMissing}</p>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {mode === "detach" ? (
                  <div className="admin-detail-card">
                    <div className="admin-section-head">
                      <div>
                        <h3>{workflowCopy.common.targetAuthor}</h3>
                        <p className="admin-panel-head-copy">{workflowCopy.sourceProfiles.targetSearchSubtitle}</p>
                      </div>
                    </div>
                    <div className="admin-toggle-group">
                      <button
                        type="button"
                        className={targetMode === "new" ? "admin-toggle-button is-active" : "admin-toggle-button"}
                        onClick={() => setTargetMode("new")}
                      >
                        {workflowCopy.sourceProfiles.detachTargetModeNew}
                      </button>
                      <button
                        type="button"
                        className={targetMode === "existing" ? "admin-toggle-button is-active" : "admin-toggle-button"}
                        onClick={() => setTargetMode("existing")}
                      >
                        {workflowCopy.sourceProfiles.detachTargetModeExisting}
                      </button>
                    </div>

                    {targetMode === "new" ? (
                      <label className="admin-field">
                        <span>{workflowCopy.sourceProfiles.detachNewAuthorLabel}</span>
                        <input value={newAuthorName} onChange={(event) => setNewAuthorName(event.target.value)} />
                      </label>
                    ) : (
                      <div className="admin-action-stack">
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
                              placeholder={workflowCopy.sourceProfiles.targetSearchPlaceholder}
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
                        <AdminAuthorResultsList
                          authors={targetResults}
                          selectedId={targetBundle?.author._id}
                          institutionFallback={workflowCopy.common.unknownInstitution}
                          emptyText={workflowCopy.sourceProfiles.targetSearchEmpty}
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
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="admin-detail-card admin-transfer-action-card">
                  <p className="admin-help-text">{reviewHint}</p>
                  <div className="admin-detail-actions admin-detail-actions-stacked">
                    <button
                      type="button"
                      className={mode === "detach" ? "admin-primary-button" : "admin-secondary-button is-danger"}
                      onClick={() => handleReviewIntent(mode)}
                      disabled={sourceLoading || targetLoading || actionLoading}
                    >
                      {mode === "detach" ? <ArrowRightLeft size={15} /> : <Trash2 size={15} />}
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
          title={
            mode === "detach"
              ? workflowCopy.sourceProfiles.detachReviewTitle
              : workflowCopy.sourceProfiles.removeReviewTitle
          }
          subtitle={
            mode === "detach"
              ? workflowCopy.sourceProfiles.detachReviewSubtitle
              : workflowCopy.sourceProfiles.removeReviewSubtitle
          }
          cancelLabel={workflowCopy.common.cancelAction}
          confirmLabel={
            mode === "detach"
              ? workflowCopy.sourceProfiles.detachConfirm
              : workflowCopy.sourceProfiles.removeConfirm
          }
          confirmLoadingLabel={
            mode === "detach"
              ? workflowCopy.sourceProfiles.detachConfirmLoading
              : workflowCopy.sourceProfiles.removeConfirmLoading
          }
          loading={actionLoading}
          danger={mode === "remove"}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void handleSubmit()}
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
              emptyLabel={
                targetMode === "new"
                  ? newAuthorName.trim() || workflowCopy.common.newAuthor
                  : workflowCopy.common.noSelection
              }
              author={targetMode === "existing" ? targetBundle?.author : null}
              publicationCount={targetMode === "existing" ? targetBundle?.publicationsCount ?? 0 : 0}
              institutionFallback={workflowCopy.common.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                sourceProfiles: workflowCopy.common.sourceProfiles,
                publications: workflowCopy.common.publications,
                aliases: workflowCopy.common.aliases,
              }}
              subtitle={
                mode === "remove"
                  ? workflowCopy.sourceProfiles.modeRemove
                  : targetMode === "new"
                    ? workflowCopy.common.newAuthor
                    : workflowCopy.common.chooseExistingAuthor
              }
            />
          </div>
          <div className="admin-selection-summary">
            <div className="admin-selection-summary-block">
              <strong>{workflowCopy.sourceProfiles.selectedProfilesTitle}</strong>
              <div className="admin-result-preview">
                {selectedProfiles.map((profile) => (
                  <span key={getSourceProfileKey(profile)}>
                    {formatSourceProfileLabel(profile)} · {profile.externalAuthorId}
                  </span>
                ))}
              </div>
            </div>
            {selectedPublications.length > 0 ? (
              <div className="admin-selection-summary-block">
                <strong>{workflowCopy.sourceProfiles.selectedPublicationsTitle}</strong>
                <div className="admin-result-preview">
                  {selectedPublications.map((publication) => (
                    <span key={publication._id}>{publication.title}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </AdminOperationModal>
      </div>
    </main>
  );
}
