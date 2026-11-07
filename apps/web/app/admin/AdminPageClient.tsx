"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Link2,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, clearStoredAuthToken, setStoredAuthToken } from "@/api";
import type { AdminCatalogAuthor } from "@/api";
import { AuthorPageTopbar } from "../author/components/AuthorPageTopbar";
import { useI18n } from "../i18n/I18nProvider";
import { useTheme } from "../theme/ThemeProvider";
import { formatAdminCopy, getAdminCopy } from "./adminCopy";
import {
  getAdminAuthorBundleCached,
  invalidateAdminAuthorBundle,
  invalidateAdminAuthorSearches,
  searchAdminAuthorsCached,
  updateCachedAdminAuthor,
} from "./adminDataCache";
import {
  dedupeAuthorResults,
  getAuthorLocation,
  getErrorMessage,
  getPrimaryInstitution,
  joinLines,
  safeJsonStringify,
  splitLines,
} from "./adminUtils";
import { AdminAuthorResultsList } from "./components/AdminAuthorResultsList";
import { AdminOperationNav } from "./components/AdminOperationNav";
import { AdminWorkspaceNav } from "./components/AdminWorkspaceNav";
import { useAdminSession } from "./useAdminSession";

type AuthorEditorState = {
  fullName: string;
  aliasesText: string;
  affiliationsText: string;
  institutionAliasesText: string;
  searchKeywordsText: string;
  university: string;
  city: string;
  country: string;
  emailDomain: string;
  orcid: string;
  parsedAffiliationsText: string;
};

const emptyEditorState: AuthorEditorState = {
  fullName: "",
  aliasesText: "",
  affiliationsText: "",
  institutionAliasesText: "",
  searchKeywordsText: "",
  university: "",
  city: "",
  country: "",
  emailDomain: "",
  orcid: "",
  parsedAffiliationsText: "[]",
};

function createEditorState(author: AdminCatalogAuthor): AuthorEditorState {
  return {
    fullName: author.fullName ?? "",
    aliasesText: joinLines(author.aliases),
    affiliationsText: joinLines(author.affiliations),
    institutionAliasesText: joinLines(author.institutionAliases),
    searchKeywordsText: joinLines(author.searchKeywords),
    university: author.university ?? "",
    city: author.city ?? "",
    country: author.country ?? "",
    emailDomain: author.emailDomain ?? "",
    orcid: author.orcid ?? "",
    parsedAffiliationsText: safeJsonStringify(author.parsedAffiliations ?? []),
  };
}

function SummaryCard(props: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  tone?: "default" | "warning" | "accent";
}) {
  const Icon = props.icon;
  const className = [
    "admin-summary-card",
    props.tone === "warning" ? "is-warning" : "",
    props.tone === "accent" ? "is-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="admin-summary-card-icon" aria-hidden="true">
        <Icon size={16} />
      </div>
      <div className="admin-summary-card-copy">
        <div className="admin-summary-card-label">{props.label}</div>
        <strong>{props.value}</strong>
        {props.note ? <p className="admin-summary-card-note">{props.note}</p> : null}
      </div>
    </div>
  );
}

export default function AdminPageClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, toggle } = useTheme();
  const { locale, t } = useI18n();
  const copy = useMemo(() => getAdminCopy(locale), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const { authState, currentUser, refreshSession } = useAdminSession();
  const presetQuery = searchParams.get("q")?.trim() ?? "";
  const presetAuthorId = searchParams.get("authorId")?.trim() ?? "";

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [query, setQuery] = useState(presetQuery);
  const [results, setResults] = useState<AdminCatalogAuthor[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [activeAuthorId, setActiveAuthorId] = useState(presetAuthorId);
  const [activeAuthor, setActiveAuthor] = useState<AdminCatalogAuthor | null>(null);
  const [activeAuthorPublicationCount, setActiveAuthorPublicationCount] = useState(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [editor, setEditor] = useState<AuthorEditorState>(emptyEditorState);
  const [saveLoading, setSaveLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const workspaceRequestRef = useRef(0);
  const hydratedQueryRef = useRef("");

  const currentUserLabel =
    currentUser?.fullName ?? currentUser?.email ?? copy.authors.labels.unknownUser;
  const adminBrandName = `${t("brand.name")} Admin`;

  const conflictCount = useMemo(() => {
    if (!activeAuthor) return 0;
    const activeProfiles = new Set((activeAuthor.sourceProfiles ?? []).map((profile) => `${profile.platformKey ?? profile.platform}:${profile.externalAuthorId}`));
    return results.filter((candidate) => {
      if (candidate._id === activeAuthor._id) return false;
      return (candidate.sourceProfiles ?? []).some((profile) =>
        activeProfiles.has(`${profile.platformKey ?? profile.platform}:${profile.externalAuthorId}`),
      );
    }).length;
  }, [activeAuthor, results]);

  const summaryCards = useMemo(
    () => [
      {
        icon: Link2,
        label: copy.authors.stats.profiles,
        value: numberFormatter.format(activeAuthor?.sourceProfiles?.length ?? 0),
        note: getPrimaryInstitution(activeAuthor, copy.authors.labels.unknownInstitution),
        tone: "accent" as const,
      },
      {
        icon: BookOpen,
        label: copy.authors.stats.publications,
        value: numberFormatter.format(activeAuthorPublicationCount),
        note: activeAuthor ? activeAuthor.fullName : copy.authors.heroSelectionHint,
      },
      {
        icon: Sparkles,
        label: copy.authors.stats.aliases,
        value: numberFormatter.format(activeAuthor?.aliases?.length ?? 0),
        note: copy.authors.profile.searchSubtitle,
      },
      {
        icon: Building2,
        label: copy.authors.stats.conflicts,
        value: numberFormatter.format(conflictCount),
        note: formatAdminCopy(copy.authors.heroConflictCount, {
          count: numberFormatter.format(conflictCount),
        }),
        tone: conflictCount > 0 ? ("warning" as const) : ("default" as const),
      },
    ],
    [activeAuthor, activeAuthorPublicationCount, conflictCount, copy, numberFormatter],
  );

  const loadWorkspace = async (authorId: string, options: { force?: boolean } = {}) => {
    if (!authorId) return;

    const requestId = ++workspaceRequestRef.current;
    setDetailsLoading(true);
    setDetailsError(null);
    setFeedback(null);

    try {
      const bundle = await getAdminAuthorBundleCached(authorId, options);
      if (workspaceRequestRef.current !== requestId) return;
      const { author, publications } = bundle;
      setActiveAuthor(author);
      setActiveAuthorPublicationCount(publications.length);
      setEditor(createEditorState(author));
      setResults((current) =>
        current.map((item) => (item._id === author._id ? { ...item, ...author } : item)),
      );
    } catch (error) {
      if (workspaceRequestRef.current !== requestId) return;
      setDetailsError(getErrorMessage(error, copy.authors.messages.loadDetailFailed));
    } finally {
      if (workspaceRequestRef.current === requestId) {
        setDetailsLoading(false);
      }
    }
  };

  const runSearch = async (value = query, preferredAuthorId?: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResultsError(copy.authors.searchHint);
      return;
    }

    hydratedQueryRef.current = trimmed;
    setResultsLoading(true);
    setResultsError(null);

    try {
      const response = await searchAdminAuthorsCached(trimmed, 25);
      const items = dedupeAuthorResults(response.items ?? []);
      setResults(items);
      const nextActiveId =
        preferredAuthorId && items.some((item) => item._id === preferredAuthorId)
          ? preferredAuthorId
          : items[0]?._id ?? "";
      const params = new URLSearchParams(searchParams.toString());
      params.set("q", trimmed);
      if (nextActiveId) {
        params.set("authorId", nextActiveId);
      } else {
        params.delete("authorId");
      }
      router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
      setActiveAuthorId(nextActiveId);

      if (nextActiveId) {
        void loadWorkspace(nextActiveId);
      } else {
        setActiveAuthor(null);
        setActiveAuthorPublicationCount(0);
      }
    } catch (error) {
      setResultsError(getErrorMessage(error, copy.authors.messages.searchFailed));
      setResults([]);
      setActiveAuthor(null);
      setActiveAuthorPublicationCount(0);
      setActiveAuthorId("");
    } finally {
      setResultsLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== "ready" || presetQuery.length < 2) return;
    if (hydratedQueryRef.current === presetQuery) return;
    hydratedQueryRef.current = presetQuery;
    setQuery(presetQuery);
    void runSearch(presetQuery, presetAuthorId || undefined);
  }, [authState, presetAuthorId, presetQuery]);

  const handleAdminLogin = async () => {
    const email = loginEmail.trim();
    const password = loginPassword;

    if (!email || !password) {
      setLoginError(copy.authors.loginRequiredError);
      return;
    }

    setLoginLoading(true);
    setLoginError(null);

    try {
      const response = await api.auth.login({ email, password });
      if (!response.user.isAdmin) {
        clearStoredAuthToken();
        setLoginError(copy.authors.loginForbiddenError);
        return;
      }

      setStoredAuthToken(response.token);
      const sessionUser = await refreshSession(response.token);
      if (!sessionUser?.isAdmin) {
        clearStoredAuthToken();
        setLoginError(copy.authors.loginForbiddenError);
        return;
      }
      setLoginEmail(email);
      setLoginPassword("");
    } catch (error) {
      clearStoredAuthToken();
      setLoginError(getErrorMessage(error, copy.authors.messages.loginFailed));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveAuthor = async () => {
    if (!activeAuthorId) return;

    let parsedAffiliations: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(editor.parsedAffiliationsText || "[]");
      if (!Array.isArray(parsed)) {
        throw new Error("array expected");
      }
      parsedAffiliations = parsed as Array<Record<string, unknown>>;
    } catch {
      setFeedback({ type: "error", text: copy.authors.messages.saveInvalidAffiliations });
      return;
    }

    setSaveLoading(true);
    setFeedback(null);

    try {
      const saved = await api.admin.updateAuthor(activeAuthorId, {
        fullName: editor.fullName,
        aliases: splitLines(editor.aliasesText),
        affiliations: splitLines(editor.affiliationsText),
        institutionAliases: splitLines(editor.institutionAliasesText),
        searchKeywords: splitLines(editor.searchKeywordsText),
        university: editor.university || null,
        city: editor.city || null,
        country: editor.country || null,
        emailDomain: editor.emailDomain || null,
        orcid: editor.orcid || null,
        parsedAffiliations,
      });

      setActiveAuthor(saved);
      setEditor(createEditorState(saved));
      setResults((current) => current.map((item) => (item._id === saved._id ? { ...item, ...saved } : item)));
      updateCachedAdminAuthor(saved);
      invalidateAdminAuthorSearches();
      setFeedback({ type: "success", text: copy.authors.messages.saveSuccess });
    } catch (error) {
      setFeedback({ type: "error", text: getErrorMessage(error, copy.authors.messages.saveFailed) });
    } finally {
      setSaveLoading(false);
    }
  };

  if (authState === "loading") {
    return (
      <main className="authors-page admin-page">
        <div className="authors-shell">
          <AuthorPageTopbar
            backHref="/"
            backLabel={copy.authors.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.authors.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card">
            <ShieldCheck size={20} />
            <div>{copy.authors.loadingSession}</div>
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
            backHref="/"
            backLabel={copy.authors.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.authors.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-login-shell">
            <div className="admin-login-card">
              <div className="admin-login-hero">
                <div className="admin-login-badge">
                  <ShieldAlert size={18} />
                  {copy.authors.loginBadge}
                </div>
                <h1>{copy.authors.loginTitle}</h1>
                <p>{copy.authors.loginBody}</p>
              </div>
              <form
                className="admin-login-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAdminLogin();
                }}
              >
                <label className="admin-login-field">
                  <span>{copy.authors.loginEmail}</span>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="admin@unipub.ai"
                    autoComplete="email"
                  />
                </label>
                <label className="admin-login-field">
                  <span>{copy.authors.loginPassword}</span>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder={copy.authors.loginPasswordPlaceholder}
                    autoComplete="current-password"
                  />
                </label>
                {loginError ? <div className="admin-login-error">{loginError}</div> : null}
                <div className="admin-login-actions admin-login-actions-stacked">
                  <button
                    type="submit"
                    className="admin-primary-button admin-login-submit"
                    disabled={loginLoading}
                  >
                    {loginLoading ? copy.authors.loginActionLoading : copy.authors.loginAction}
                    <ArrowRight size={16} />
                  </button>
                  <Link href="/" className="admin-secondary-button admin-secondary-button-quiet admin-login-home">
                    {copy.authors.backToHome}
                  </Link>
                </div>
              </form>
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
            backHref="/"
            backLabel={copy.authors.backLabel}
            brandName={adminBrandName}
            brandSubtitle={copy.authors.topbarSubtitle}
            theme={theme}
            themeToggleLabel={t("theme.toggle")}
            onToggleTheme={toggle}
          />
          <section className="admin-status-card is-danger">
            <ShieldX size={20} />
            <div>
              <strong>{copy.authors.forbiddenTitle}</strong>
              <p>{currentUser?.email ?? copy.authors.labels.unknownUser}</p>
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
          backHref="/"
          backLabel={copy.authors.backLabel}
          brandName={adminBrandName}
          brandSubtitle={copy.authors.topbarSubtitle}
          theme={theme}
          themeToggleLabel={t("theme.toggle")}
          onToggleTheme={toggle}
        />
        <AdminWorkspaceNav />
        <AdminOperationNav authorId={activeAuthor?._id ?? activeAuthorId} query={query} />

        {feedback ? (
          <section className={feedback.type === "success" ? "admin-feedback-card is-success" : "admin-feedback-card is-error"}>
            {feedback.text}
          </section>
        ) : null}

        <section className="admin-search-card">
          <div className="admin-search-head">
            <div>
              <h2>{copy.authors.searchTitle}</h2>
              <p>{copy.authors.searchSubtitle}</p>
            </div>
            <div className="admin-search-note">{copy.authors.searchHint}</div>
          </div>

          <form
            className="admin-searchbar"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(query, activeAuthorId);
            }}
          >
            <label className="authors-search-input">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.authors.searchPlaceholder}
              />
            </label>
            <button
              type="submit"
              className="admin-primary-button admin-search-submit"
              disabled={resultsLoading || query.trim().length < 2}
            >
              {resultsLoading ? copy.authors.searchActionLoading : copy.authors.searchAction}
            </button>
          </form>
          {resultsError ? <p className="authors-error">{resultsError}</p> : null}
        </section>

        <section className="admin-grid admin-workspace-grid">
          <aside className="admin-panel admin-panel-sidebar">
            <div className="admin-panel-head">
              <div>
                <h2>{copy.authors.resultsTitle}</h2>
                <p className="admin-panel-head-copy">{copy.authors.workspaceEmpty}</p>
              </div>
              <span>{formatAdminCopy(copy.authors.labels.records, { count: numberFormatter.format(results.length) })}</span>
            </div>
            <AdminAuthorResultsList
              authors={results}
              selectedId={activeAuthorId}
              emptyText={copy.authors.resultsEmpty}
              institutionFallback={copy.authors.labels.unknownInstitution}
              labels={{
                id: copy.authors.labels.id,
                moreProfiles: copy.authors.labels.moreProfiles,
              }}
              onSelect={(author) => {
                setActiveAuthorId(author._id);
                const params = new URLSearchParams(searchParams.toString());
                if (query.trim()) {
                  params.set("q", query.trim());
                }
                params.set("authorId", author._id);
                router.replace(`${pathname}?${params.toString()}`);
                void loadWorkspace(author._id);
              }}
            />
          </aside>

          <section className="admin-panel admin-panel-wide">
            <div className="admin-panel-head">
              <div>
                <h2>{copy.authors.workspaceTitle}</h2>
                <p className="admin-panel-head-copy">{activeAuthor?.fullName ?? copy.authors.labels.selectedRecord}</p>
              </div>
              <span>{activeAuthor ? `${copy.authors.labels.id} · ${activeAuthor._id}` : copy.authors.labels.selectedRecord}</span>
            </div>

            {detailsLoading ? (
              <div className="admin-empty-card">{copy.authors.workspaceLoading}</div>
            ) : detailsError ? (
              <div className="admin-empty-card">{detailsError}</div>
            ) : !activeAuthor ? (
              <div className="admin-empty-card">{copy.authors.workspaceEmpty}</div>
            ) : (
              <div className="admin-detail-stack">
                <section className="admin-workspace-hero">
                  <div className="admin-workspace-copy">
                    <p className="admin-eyebrow">{copy.authors.activeAuthorEyebrow}</p>
                    <h2>{activeAuthor.fullName}</h2>
                    <div className="admin-inline-list">
                      <span>
                        {copy.authors.labels.id}: {activeAuthor._id}
                      </span>
                      <span>{getPrimaryInstitution(activeAuthor, copy.authors.labels.unknownInstitution)}</span>
                      {getAuthorLocation(activeAuthor) ? <span>{getAuthorLocation(activeAuthor)}</span> : null}
                    </div>
                    <div className="admin-result-preview admin-result-preview-tight">
                      <span>{numberFormatter.format(activeAuthor.sourceProfiles?.length ?? 0)} {copy.authors.stats.profiles.toLowerCase()}</span>
                      <span>{numberFormatter.format(activeAuthorPublicationCount)} {copy.authors.stats.publications.toLowerCase()}</span>
                      <span>{numberFormatter.format(conflictCount)} {copy.authors.stats.conflicts.toLowerCase()}</span>
                    </div>
                  </div>
                  <div className="admin-action-row admin-action-row-compact">
                    <button
                      type="button"
                      className="admin-primary-button"
                      onClick={() => void handleSaveAuthor()}
                      disabled={saveLoading}
                    >
                      <Save size={15} />
                      {saveLoading ? copy.authors.quickActionsSaving : copy.authors.quickActionsSave}
                    </button>
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => {
                        invalidateAdminAuthorBundle(activeAuthor._id);
                        void loadWorkspace(activeAuthor._id, { force: true });
                      }}
                    >
                      <RefreshCcw size={15} />
                      {copy.authors.quickActionsRefresh}
                    </button>
                  </div>
                </section>

                <section className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{copy.authors.profile.identityTitle}</h3>
                      <p className="admin-panel-head-copy">{copy.authors.profile.identitySubtitle}</p>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <label className="admin-field">
                      <span>{copy.authors.profile.fullName}</span>
                      <input
                        value={editor.fullName}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, fullName: event.target.value }))
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.authors.profile.university}</span>
                      <input
                        value={editor.university}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, university: event.target.value }))
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.authors.profile.city}</span>
                      <input
                        value={editor.city}
                        onChange={(event) => setEditor((current) => ({ ...current, city: event.target.value }))}
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.authors.profile.country}</span>
                      <input
                        value={editor.country}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, country: event.target.value }))
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.authors.profile.emailDomain}</span>
                      <input
                        value={editor.emailDomain}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, emailDomain: event.target.value }))
                        }
                      />
                    </label>
                    <label className="admin-field">
                      <span>{copy.authors.profile.orcid}</span>
                      <input
                        value={editor.orcid}
                        onChange={(event) => setEditor((current) => ({ ...current, orcid: event.target.value }))}
                      />
                    </label>
                  </div>
                </section>

                <section className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{copy.authors.profile.searchTitle}</h3>
                      <p className="admin-panel-head-copy">{copy.authors.profile.searchSubtitle}</p>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <label className="admin-field admin-field-wide">
                      <span>{copy.authors.profile.aliases}</span>
                      <textarea
                        value={editor.aliasesText}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, aliasesText: event.target.value }))
                        }
                        rows={4}
                      />
                    </label>
                    <label className="admin-field admin-field-wide">
                      <span>{copy.authors.profile.affiliations}</span>
                      <textarea
                        value={editor.affiliationsText}
                        onChange={(event) =>
                          setEditor((current) => ({ ...current, affiliationsText: event.target.value }))
                        }
                        rows={5}
                      />
                    </label>
                    <label className="admin-field admin-field-wide">
                      <span>{copy.authors.profile.institutionAliases}</span>
                      <textarea
                        value={editor.institutionAliasesText}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            institutionAliasesText: event.target.value,
                          }))
                        }
                        rows={4}
                      />
                    </label>
                    <label className="admin-field admin-field-wide">
                      <span>{copy.authors.profile.searchKeywords}</span>
                      <textarea
                        value={editor.searchKeywordsText}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            searchKeywordsText: event.target.value,
                          }))
                        }
                        rows={4}
                      />
                    </label>
                  </div>
                </section>

                <section className="admin-detail-card">
                  <div className="admin-section-head">
                    <div>
                      <h3>{copy.authors.profile.parsedTitle}</h3>
                      <p className="admin-panel-head-copy">{copy.authors.profile.parsedSubtitle}</p>
                    </div>
                  </div>
                  <label className="admin-field">
                    <span>{copy.authors.profile.parsedLabel}</span>
                    <textarea
                      className="admin-json-input"
                      value={editor.parsedAffiliationsText}
                      onChange={(event) =>
                        setEditor((current) => ({ ...current, parsedAffiliationsText: event.target.value }))
                      }
                      rows={12}
                    />
                  </label>
                </section>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
