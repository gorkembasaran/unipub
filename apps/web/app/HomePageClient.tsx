"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  Database,
  FileText,
  Filter,
  Globe2,
  Moon,
  MailCheck,
  Search,
  Share2,
  Sparkles,
  Sun,
  LogOut,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import { api, clearStoredAuthToken, getStoredAuthToken, setStoredAuthToken } from "@/api";
import type { AuthUser } from "@/api";
import { useI18n } from "./i18n/I18nProvider";
import { useTheme } from "./theme/ThemeProvider";
import type { CatalogStats } from "@/api/platforms/catalog";
import UnipubLogo from "./components/UnipubLogo";
import { useDiscoveryFilters } from "./hooks/useDiscoveryFilters";
import LanguageSwitcher from "./components/LanguageSwitcher";

const defaultStats: CatalogStats = {
  totalPublications: 0,
  totalAuthors: 0,
  totalInstitutions: 0,
  totalCountries: 0,
  fetchedAt: new Date(0).toISOString(),
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function findOptionLabel(
  value: string,
  options: Array<{ value: string; label: string }>,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const rawMessage = error.message;
  const jsonStart = rawMessage.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        message?: string | string[];
      };
      if (Array.isArray(parsed.message)) return parsed.message.join(" ");
      if (parsed.message) return parsed.message;
    } catch {
      return rawMessage;
    }
  }

  return rawMessage.replace(/^API error \d+:\s*/, "") || fallback;
}

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<CatalogStats>(defaultStats);
  const [statsLoading, setStatsLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authFullName, setAuthFullName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [school, setSchool] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const { filterData, filterLoading, filterError, filterReady } = useDiscoveryFilters({
    country,
    city,
  });

  const statsCards = useMemo(
    () =>
      [
        {
          key: "pubs",
          value: stats.totalPublications,
          label: t("home.stats.publications"),
          icon: <FileText size={22} />,
          tone: "blue",
        },
        {
          key: "authors",
          value: stats.totalAuthors,
          label: t("home.stats.authors"),
          icon: <Users size={22} />,
          tone: "purple",
        },
        {
          key: "institutions",
          value: stats.totalInstitutions,
          label: t("home.stats.institutions"),
          icon: <Building2 size={22} />,
          tone: "pink",
        },
        {
          key: "countries",
          value: stats.totalCountries,
          label: t("home.stats.countries"),
          icon: <Globe2 size={22} />,
          tone: "cyan",
        },
      ] satisfies Array<{ key: string; value: number; label: string; icon: ReactNode; tone: string }>,
    [stats, t],
  );

  const featureCards = useMemo(
    () =>
      [
        {
          key: "fast",
          icon: <Zap size={24} />,
          title: t("home.features.fast.title"),
          description: t("home.features.fast.desc"),
          tone: "amber",
        },
        {
          key: "db",
          icon: <Database size={24} />,
          title: t("home.features.db.title"),
          description: t("home.features.db.desc"),
          tone: "indigo",
        },
        {
          key: "export",
          icon: <Share2 size={24} />,
          title: t("home.features.export.title"),
          description: t("home.features.export.desc"),
          tone: "emerald",
        },
      ] satisfies Array<{
        key: string;
        icon: ReactNode;
        title: string;
        description: string;
        tone: string;
      }>,
    [t],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.catalog.getStats();
        setStats(response);
      } catch {
        setStats(defaultStats);
      } finally {
        setStatsLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    const token = getStoredAuthToken();
    if (!token) return;
    setAuthToken(token);
    api.auth
      .me(token)
      .then((response) => setAuthUser(response.user))
      .catch(() => {
        clearStoredAuthToken();
        setAuthToken(null);
        setAuthUser(null);
      });
  }, []);

  useEffect(() => {
    if (!filterOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filterOpen]);

  useEffect(() => {
    if (!filterReady) return;
    if (city && !filterData.cities.some((option) => option.value === city)) {
      setCity("");
    }
  }, [city, filterData.cities, filterReady]);

  useEffect(() => {
    if (!filterReady) return;
    if (school && !filterData.schools.some((option) => option.value === school)) {
      setSchool("");
    }
  }, [filterData.schools, filterReady, school]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;

    const params = new URLSearchParams();
    params.set("q", query.trim());
    if (school.trim()) params.set("school", school.trim());
    if (country.trim()) params.set("country", country.trim());
    if (city.trim()) params.set("city", city.trim());
    router.push(`/authors?${params.toString()}`);
  };

  const openAuthModal = (mode: "login" | "signup") => {
    setAuthMode(mode);
    setAuthModalOpen(true);
    setAuthError("");
    setAuthPassword("");
    setAuthPasswordConfirm("");
  };

  const handleAuthSubmit = async () => {
    setAuthError("");
    if (!authEmail.trim() || !authPassword) {
      setAuthError(t("home.auth.error.required"));
      return;
    }

    if (authMode === "signup") {
      if (!authFullName.trim()) {
        setAuthError(t("home.auth.error.full_name_required"));
        return;
      }

      if (authPassword.length < 6) {
        setAuthError(t("home.auth.error.password_short"));
        return;
      }

      if (authPassword !== authPasswordConfirm) {
        setAuthError(t("home.auth.error.password_mismatch"));
        return;
      }
    }

    setAuthLoading(true);
    try {
      const normalizedEmail = authEmail.trim();
      const response =
        authMode === "signup"
          ? await api.auth.register({
              fullName: authFullName.trim(),
              email: normalizedEmail,
              password: authPassword,
            })
          : await api.auth.login({
              email: normalizedEmail,
              password: authPassword,
            });

      setStoredAuthToken(response.token);
      setAuthToken(response.token);
      setAuthUser(response.user);
      setAuthModalOpen(false);
      setAuthFullName("");
      setAuthEmail("");
      setAuthPassword("");
      setAuthPasswordConfirm("");
    } catch (err) {
      setAuthError(getApiErrorMessage(err, t("home.auth.error.failed")));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredAuthToken();
    setAuthToken(null);
    setAuthUser(null);
    setUserModalOpen(false);
  };

  const heroTitle = t("home.hero.title");
  const heroTitleWords = heroTitle.split(" ").filter(Boolean);
  const heroAccent = heroTitleWords.pop() ?? heroTitle;
  const heroBase = heroTitleWords.join(" ");

  const activeFilters = useMemo(
    () =>
      [
        school.trim()
          ? `${t("home.search.school")}: ${findOptionLabel(
              school,
              filterData.schools,
            )}`
          : null,
        country.trim()
          ? `${t("home.search.country")}: ${findOptionLabel(
              country,
              filterData.countries,
            )}`
          : null,
        city.trim()
          ? `${t("home.search.city")}: ${findOptionLabel(city, filterData.cities)}`
          : null,
      ].filter(Boolean) as string[],
    [city, country, filterData.cities, filterData.countries, filterData.schools, school, t],
  );

  return (
    <main className="home-page home-page-revamp">
      <header className="home-topbar">
        <div className="home-brand">
          <div className="home-brand-icon">
            <UnipubLogo size={42} showText={false} variant="minimal" />
          </div>
          <div>
            <div className="home-brand-title">{t("brand.name")}</div>
            <div className="home-brand-sub">{t("brand.subtitle")}</div>
          </div>
        </div>

        <div className="home-actions">
          {authUser ? (
            <div className="home-user-menu">
              <button
                type="button"
                className="home-user-button"
                onClick={() => setUserModalOpen((open) => !open)}
                aria-expanded={userModalOpen}
              >
                <User size={16} />
                <span>{authUser.fullName}</span>
              </button>
              {userModalOpen ? (
                <div className="home-user-popover">
                  <div className="home-user-name">{authUser.fullName}</div>
                  <div className="home-user-email">{authUser.email}</div>
                  <button type="button" className="home-user-verify" disabled>
                    <MailCheck size={16} />
                    <span>{t("home.auth.verify_email")}</span>
                  </button>
                  <button type="button" onClick={handleLogout}>
                    <LogOut size={16} />
                    <span>{t("home.auth.logout")}</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <button
                type="button"
                className="home-login home-action-link"
                onClick={() => openAuthModal("login")}
              >
                {t("home.auth.login")}
              </button>
              <button
                type="button"
                className="home-signup home-action-primary"
                onClick={() => openAuthModal("signup")}
              >
                {t("home.auth.signup")}
              </button>
            </>
          )}
          <LanguageSwitcher />
          <button
            type="button"
            className="theme-toggle home-icon-action"
            onClick={toggle}
            aria-label={theme === "light" ? "Karanlık temaya geç" : "Aydınlık temaya geç"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero-badge">
          <Sparkles size={16} />
          <span>{t("home.hero.badge")}</span>
        </div>
        <h1>
          <span className="home-hero-title-main">{heroBase}</span>
          <span className="home-hero-title-accent">{heroAccent}</span>
        </h1>
        <p>{t("home.hero.subtitle")}</p>

        <section className="home-search-wrap">
          <form onSubmit={handleSearch} className="home-search-form">
            <div className="home-search-input-wrap">
              <Search size={22} className="home-search-input-icon" />
              <input
                type="text"
                placeholder={t("home.search.placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button type="submit" className="home-search-btn" disabled={!query.trim()}>
              {t("home.search.cta")}
            </button>
          </form>

          <div className="home-search-meta">
            <div className="home-search-meta-left">
              {activeFilters.length > 0 ? (
                activeFilters.map((item) => (
                  <span key={item} className="home-search-chip">
                    {item}
                  </span>
                ))
              ) : (
                <span className="home-search-hint">{t("home.search.filter_help")}</span>
              )}
            </div>
            <button
              type="button"
              className="home-filter-inline"
              aria-label={t("home.search.filter")}
              onClick={() => setFilterOpen(true)}
            >
              <Filter size={16} />
              <span>{t("home.search.filter")}</span>
            </button>
          </div>
        </section>
      </section>

      {filterOpen ? (
        <div
          className="home-filter-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setFilterOpen(false);
          }}
        >
          <div
            className="home-filter-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("home.search.filter")}
          >
            <div className="home-filter-modal-head">
              <div>
                <div className="home-filter-modal-title">{t("home.search.filter")}</div>
                <div className="home-filter-modal-sub">{t("home.search.filter_help")}</div>
                {filterError ? <div className="home-filter-modal-note">{filterError}</div> : null}
              </div>
              <button
                type="button"
                className="home-filter-modal-close"
                aria-label={t("common.close")}
                onClick={() => setFilterOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="home-filter-modal-body">
              <label className="home-filter-field">
                <span>{t("home.search.school")}</span>
                <div className="home-filter-select-wrap">
                  <select
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    disabled={filterLoading && filterData.schools.length === 0}
                  >
                    <option value="">{t("common.all")}</option>
                    {filterData.schools.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="home-filter-select-icon" aria-hidden="true" />
                </div>
              </label>

              <label className="home-filter-field">
                <span>{t("home.search.country")}</span>
                <div className="home-filter-select-wrap">
                  <select
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value);
                      setCity("");
                      setSchool("");
                    }}
                    disabled={filterLoading && filterData.countries.length === 0}
                  >
                    <option value="">{t("common.all")}</option>
                    {filterData.countries.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="home-filter-select-icon" aria-hidden="true" />
                </div>
              </label>

              <label className="home-filter-field">
                <span>{t("home.search.city")}</span>
                <div className="home-filter-select-wrap">
                  <select
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      setSchool("");
                    }}
                    disabled={filterLoading && filterData.cities.length === 0}
                  >
                    <option value="">{t("common.all")}</option>
                    {filterData.cities.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={18} className="home-filter-select-icon" aria-hidden="true" />
                </div>
              </label>
            </div>

            <div className="home-filter-modal-foot">
              <button
                type="button"
                className="home-filter-modal-secondary"
                onClick={() => {
                  setSchool("");
                  setCountry("");
                  setCity("");
                }}
              >
                {t("common.clear")}
              </button>
              <button
                type="button"
                className="home-filter-modal-primary"
                onClick={() => {
                  void school;
                  void country;
                  void city;
                  setFilterOpen(false);
                }}
              >
                {t("common.apply")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="home-stats-grid" aria-live="polite">
        {statsCards.map((card) => (
          <article key={card.key} className={`home-stat-card tone-${card.tone}`}>
            <div>
              <strong>{statsLoading ? "..." : formatNumber(card.value)}</strong>
              <span>{card.label}</span>
            </div>
            <div className="home-stat-icon">{card.icon}</div>
          </article>
        ))}
      </section>

      <section className="home-features">
        <div className="home-section-head">
          <h2>{t("home.features.title")}</h2>
          <p>{t("home.features.subtitle")}</p>
        </div>
        <div className="home-features-grid">
          {featureCards.map((feature) => (
            <article key={feature.key} className={`home-feature-card tone-${feature.tone}`}>
              <div className="feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-cta">
        <div className="home-cta-content">
          <h2>{t("home.cta.title")}</h2>
          <p>{t("home.cta.subtitle")}</p>
          <button type="button" className="home-cta-button" onClick={() => openAuthModal("signup")}>
            {t("home.cta.button")}
          </button>
        </div>
      </section>

      {authModalOpen ? (
        <div className="auth-modal-backdrop" onClick={() => setAuthModalOpen(false)}>
          <div
            className="auth-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="auth-modal-header">
              <div>
                <div className="auth-modal-title">
                  {authMode === "login" ? t("home.auth.modal_login_title") : t("home.auth.modal_signup_title")}
                </div>
                <div className="auth-modal-subtitle">
                  {authMode === "login" ? t("home.auth.modal_login_sub") : t("home.auth.modal_signup_sub")}
                </div>
              </div>
              <button
                type="button"
                className="auth-modal-close"
                onClick={() => setAuthModalOpen(false)}
                aria-label={t("common.close")}
              >
                <X size={16} />
              </button>
            </div>

            <form
              className="auth-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAuthSubmit();
              }}
            >
              {authMode === "signup" ? (
                <label>
                  {t("home.auth.full_name")}
                  <input
                    type="text"
                    placeholder={t("home.auth.full_name_placeholder")}
                    value={authFullName}
                    onChange={(event) => setAuthFullName(event.target.value)}
                    autoComplete="name"
                  />
                </label>
              ) : null}
              <label>
                {t("home.auth.email")}
                <input
                  type="email"
                  placeholder={t("home.auth.email_placeholder")}
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                {t("home.auth.password")}
                <input
                  type="password"
                  placeholder={t("home.auth.password_placeholder")}
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                />
              </label>
              {authMode === "signup" ? (
                <label>
                  {t("home.auth.password_confirm")}
                  <input
                    type="password"
                    placeholder={t("home.auth.password_placeholder")}
                    value={authPasswordConfirm}
                    onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              ) : null}
              {authError ? <div className="auth-modal-error">{authError}</div> : null}
              <button type="submit" className="auth-modal-primary" disabled={authLoading}>
                {authLoading
                  ? `${authMode === "login" ? t("home.auth.login") : t("home.auth.signup")}...`
                  : authMode === "login"
                    ? t("home.auth.login")
                    : t("home.auth.signup")}
              </button>
            </form>

            <div className="auth-modal-footer">
              {authMode === "login" ? (
                <button type="button" onClick={() => setAuthMode("signup")}>
                  {t("home.auth.switch_to_signup")}
                </button>
              ) : (
                <button type="button" onClick={() => setAuthMode("login")}>
                  {t("home.auth.switch_to_login")}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
