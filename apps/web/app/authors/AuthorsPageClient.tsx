"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/api";
import { useI18n } from "../i18n/I18nProvider";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Filter, MapPin, Moon, Search, Sun } from "lucide-react";
import UnipubLogo from "../components/UnipubLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useTheme } from "../theme/ThemeProvider";
import { useDiscoveryFilters } from "../hooks/useDiscoveryFilters";
import type { DiscoveryAuthorSearchFilters, DiscoveryAuthorsResponse } from "@/api/platforms/discovery";
import { getApiErrorMessage } from "../utils/apiErrors";

type AuthorItem = DiscoveryAuthorsResponse["items"][number];
type ParsedAffiliation = NonNullable<AuthorItem["parsedAffiliations"]>[number];
type FilterState = {
  school: string;
  city: string;
  country: string;
};

const SEARCH_LIMIT = 12;
const emptyFilters: FilterState = {
  school: "",
  city: "",
  country: "",
};

function getInitials(name: string) {
  const tokens = name
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2);
  return tokens.map((x) => x[0]?.toUpperCase() ?? "").join("") || "AU";
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function compact(values: Array<string | undefined | null>) {
  const seen = new Set<string>();

  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = value.toLocaleLowerCase("tr-TR");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeIdentityName(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(
      (token) =>
        token &&
        ![
          "google",
          "scholar",
          "akademik",
          "citation",
          "citations",
          "profile",
          "profiles",
          "profil",
          "author",
          "authors",
        ].includes(token),
    )
    .join(" ");
}

function normalizeIdentityValue(value?: string | null) {
  return value
    ?.toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getIdentityNameTokens(value?: string | null) {
  return normalizeIdentityName(value ?? "")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function haveEquivalentIdentityNames(left?: string | null, right?: string | null) {
  const leftTokens = getIdentityNameTokens(left);
  const rightTokens = getIdentityNameTokens(right);

  return (
    leftTokens.length > 0 &&
    leftTokens.length === rightTokens.length &&
    leftTokens.every((token) => rightTokens.includes(token))
  );
}

function hasSourceNoiseInName(value?: string | null) {
  return Boolean(
    value &&
      /\b(google scholar|google akademik|scholar|akademik|citations?)\b/i.test(
        value,
      ),
  );
}

function getPrimaryUniversity(author: AuthorItem) {
  return (
    author.university?.trim() ||
    author.parsedAffiliations?.find((item) => item.university?.trim())?.university?.trim() ||
    ""
  );
}

function getEmailDomain(author: AuthorItem) {
  return (
    author.emailDomain?.trim() ||
    author.parsedAffiliations?.find((item) => item.emailDomain?.trim())?.emailDomain?.trim() ||
    ""
  );
}

type AffiliationCluster = {
  city: string;
  country: string;
  emailDomain: string;
  items: ParsedAffiliation[];
  key: string;
  university: string;
};

function getAffiliationClusterKey(item: ParsedAffiliation) {
  const universityKey = normalizeIdentityValue(item.university);
  if (universityKey) {
    return `university:${universityKey}`;
  }

  const emailDomainKey = normalizeIdentityValue(item.emailDomain);
  if (emailDomainKey) {
    return `email:${emailDomainKey}`;
  }

  const cityKey = normalizeIdentityValue(item.city);
  const countryKey = normalizeIdentityValue(item.country);
  if (cityKey || countryKey) {
    return `location:${cityKey ?? ""}|${countryKey ?? ""}`;
  }

  return "";
}

function buildSplitSourceKey(author: AuthorItem) {
  return [
    normalizeIdentityName(author.displayName ?? ""),
    author.dbAuthorId?.trim() ?? "",
    normalizeIdentityValue(author.university) ?? "",
    normalizeIdentityValue(author.city) ?? "",
    normalizeIdentityValue(author.country) ?? "",
  ].join("|");
}

function filterSourceProfilesForCluster(
  author: AuthorItem,
  clusterItems: ParsedAffiliation[],
) {
  const sourceProfiles = author.sourceProfiles ?? [];
  if (sourceProfiles.length === 0) {
    return sourceProfiles;
  }

  const platformKeys = new Set(
    clusterItems
      .map((item) => item.platform?.trim().toLocaleLowerCase("tr-TR"))
      .filter((value): value is string => Boolean(value)),
  );

  if (platformKeys.size === 0) {
    return sourceProfiles;
  }

  const filtered = sourceProfiles.filter((profile) =>
    platformKeys.has(profile.platform?.trim().toLocaleLowerCase("tr-TR") ?? ""),
  );

  return filtered.length > 0 ? filtered : sourceProfiles;
}

function splitMergedAuthorItem(author: AuthorItem) {
  const parsedAffiliations = author.parsedAffiliations ?? [];
  if (parsedAffiliations.length < 2) {
    return [author];
  }

  const clusters = new Map<string, AffiliationCluster>();

  for (const item of parsedAffiliations) {
    const key = getAffiliationClusterKey(item);
    if (!key) {
      continue;
    }

    const current = clusters.get(key);
    if (current) {
      current.items.push(item);
      continue;
    }

    clusters.set(key, {
      city: item.city?.trim() ?? "",
      country: item.country?.trim() ?? "",
      emailDomain: item.emailDomain?.trim() ?? "",
      items: [item],
      key,
      university: item.university?.trim() ?? "",
    });
  }

  const uniqueUniversityCount = new Set(
    Array.from(clusters.values())
      .map((cluster) => normalizeIdentityValue(cluster.university))
      .filter(Boolean),
  ).size;
  const uniqueLocationCount = new Set(
    Array.from(clusters.values())
      .map(
        (cluster) =>
          `${normalizeIdentityValue(cluster.city) ?? ""}|${normalizeIdentityValue(cluster.country) ?? ""}`,
      )
      .filter((value) => value !== "|"),
  ).size;

  const hasUniversityConflict = uniqueUniversityCount >= 2;
  const hasLocationConflict = uniqueUniversityCount < 2 && uniqueLocationCount >= 2;

  if (clusters.size < 2 || (!hasUniversityConflict && !hasLocationConflict)) {
    return [author];
  }

  const splitSourceKey = buildSplitSourceKey(author);

  return Array.from(clusters.values()).map((cluster) => {
    const clusterAffiliations = compact([
      ...cluster.items.map((item) => item.raw),
      cluster.university,
      cluster.city,
      cluster.country,
    ]);
    const clusterSourceProfiles = filterSourceProfilesForCluster(
      author,
      cluster.items,
    );
    return {
      ...author,
      affiliationRaw: clusterAffiliations,
      city: cluster.city || author.city,
      country: cluster.country || author.country,
      dbAuthorId: undefined,
      dbMatchScore: undefined,
      emailDomain: cluster.emailDomain || author.emailDomain,
      hIndex: undefined,
      parsedAffiliations: cluster.items,
      publications: undefined,
      citations: undefined,
      sourceProfiles: clusterSourceProfiles,
      splitClusterKey: cluster.key,
      splitSourceKey,
      university: cluster.university || author.university,
    };
  });
}

function splitMergedAuthorResults(items: AuthorItem[]) {
  return items.flatMap((item) => splitMergedAuthorItem(item));
}

function hasSharedSourceProfile(left: AuthorItem, right: AuthorItem) {
  const rightKeys = new Set(
    (right.sourceProfiles ?? []).map((profile) => `${profile.platform}:${profile.externalAuthorId}`),
  );

  return (left.sourceProfiles ?? []).some((profile) =>
    rightKeys.has(`${profile.platform}:${profile.externalAuthorId}`),
  );
}

function mergeUniqueSourceProfiles(
  left: NonNullable<AuthorItem["sourceProfiles"]> = [],
  right: NonNullable<AuthorItem["sourceProfiles"]> = [],
) {
  const map = new Map<string, NonNullable<AuthorItem["sourceProfiles"]>[number]>();

  for (const profile of [...left, ...right]) {
    const key = `${profile.platform}:${profile.externalAuthorId}`;
    if (!map.has(key)) {
      map.set(key, profile);
    }
  }

  return Array.from(map.values());
}

function mergeUniqueParsedAffiliations(
  left: NonNullable<AuthorItem["parsedAffiliations"]> = [],
  right: NonNullable<AuthorItem["parsedAffiliations"]> = [],
) {
  const map = new Map<string, NonNullable<AuthorItem["parsedAffiliations"]>[number]>();

  for (const item of [...left, ...right]) {
    const key =
      item.raw?.trim().toLocaleLowerCase("tr-TR") ||
      [
        item.university,
        item.department,
        item.faculty,
        item.city,
        item.country,
      ]
        .filter(Boolean)
        .join("|")
        .toLocaleLowerCase("tr-TR");
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }

  return Array.from(map.values());
}

function scoreAuthorItemQuality(author: AuthorItem) {
  const displayName = author.displayName?.trim() ?? "";
  const sourceCount = author.sourceProfiles?.length ?? 0;

  return (
    (author.dbMatchScore ?? 0) * 1000 +
    sourceCount * 12 +
    (getPrimaryUniversity(author) ? 8 : 0) +
    (getEmailDomain(author) ? 8 : 0) +
    (hasSourceNoiseInName(displayName) ? -50 : 0) +
    Math.min(displayName.length, 40) / 4
  );
}

function shouldMergeAuthorItems(left: AuthorItem, right: AuthorItem) {
  if (
    left.splitSourceKey &&
    right.splitSourceKey &&
    left.splitSourceKey === right.splitSourceKey &&
    left.splitClusterKey &&
    right.splitClusterKey &&
    left.splitClusterKey !== right.splitClusterKey
  ) {
    return false;
  }

  const leftName = normalizeIdentityName(left.displayName ?? "");
  const rightName = normalizeIdentityName(right.displayName ?? "");
  const equivalentNames = haveEquivalentIdentityNames(
    left.displayName,
    right.displayName,
  );
  const leftUniversity = normalizeIdentityValue(getPrimaryUniversity(left));
  const rightUniversity = normalizeIdentityValue(getPrimaryUniversity(right));
  const leftLocation = normalizeIdentityValue(compact([left.city, left.country]).join(" "));
  const rightLocation = normalizeIdentityValue(compact([right.city, right.country]).join(" "));
  const sharedSourceProfile = hasSharedSourceProfile(left, right);

  // Prefer showing duplicates over collapsing two different people into one card.
  if (
    leftUniversity &&
    rightUniversity &&
    leftUniversity !== rightUniversity &&
    !sharedSourceProfile
  ) {
    return false;
  }

  if (sharedSourceProfile) {
    return true;
  }

  if (
    left.dbAuthorId &&
    right.dbAuthorId &&
    left.dbAuthorId === right.dbAuthorId &&
    equivalentNames
  ) {
    return true;
  }

  if (!leftName || !rightName || !equivalentNames) {
    return false;
  }

  const leftEmail = normalizeIdentityValue(getEmailDomain(left));
  const rightEmail = normalizeIdentityValue(getEmailDomain(right));
  if (leftEmail && rightEmail && leftEmail === rightEmail) {
    return true;
  }

  if (
    leftUniversity &&
    rightUniversity &&
    leftUniversity === rightUniversity &&
    (!leftLocation || !rightLocation || leftLocation === rightLocation)
  ) {
    return true;
  }

  return false;
}

function mergeAuthorItems(primary: AuthorItem, secondary: AuthorItem): AuthorItem {
  return {
    ...primary,
    dbAuthorId: primary.dbAuthorId || secondary.dbAuthorId,
    normalizedName:
      normalizeIdentityName(primary.displayName || "") ||
      primary.normalizedName ||
      secondary.normalizedName,
    aliases: compact([...(primary.aliases ?? []), ...(secondary.aliases ?? [])]),
    affiliationRaw: compact([
      ...(primary.affiliationRaw ?? []),
      ...(secondary.affiliationRaw ?? []),
    ]),
    parsedAffiliations: mergeUniqueParsedAffiliations(
      primary.parsedAffiliations ?? [],
      secondary.parsedAffiliations ?? [],
    ),
    searchKeywords: compact([
      ...(primary.searchKeywords ?? []),
      ...(secondary.searchKeywords ?? []),
    ]),
    sourceProfiles: mergeUniqueSourceProfiles(
      primary.sourceProfiles ?? [],
      secondary.sourceProfiles ?? [],
    ),
    score: Math.max(primary.score ?? 0, secondary.score ?? 0),
    dbMatchScore: Math.max(primary.dbMatchScore ?? 0, secondary.dbMatchScore ?? 0),
    university: primary.university || secondary.university,
    city: primary.city || secondary.city,
    country: primary.country || secondary.country,
    emailDomain: primary.emailDomain || secondary.emailDomain,
    recentWork: primary.recentWork || secondary.recentWork,
    publications:
      typeof primary.publications === "number"
        ? primary.publications
        : secondary.publications,
    citations:
      typeof primary.citations === "number"
        ? primary.citations
        : secondary.citations,
    hIndex:
      typeof primary.hIndex === "number" ? primary.hIndex : secondary.hIndex,
  };
}

function dedupeAuthorResults(items: AuthorItem[]) {
  const merged: AuthorItem[] = [];

  for (const item of items) {
    const existingIndex = merged.findIndex((candidate) =>
      shouldMergeAuthorItems(candidate, item),
    );

    if (existingIndex === -1) {
      merged.push(item);
      continue;
    }

    const current = merged[existingIndex];
    const [preferred, secondary] =
      scoreAuthorItemQuality(item) > scoreAuthorItemQuality(current)
        ? [item, current]
        : [current, item];

    merged[existingIndex] = mergeAuthorItems(preferred, secondary);
  }

  return merged;
}

function findOptionLabel(
  value: string,
  options: Array<{ value: string; label: string }>,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function getTitleBlock(parsedAffiliations: ParsedAffiliation[]) {
  const titleEntry = parsedAffiliations.find((item) => item.personTitle || item.role);
  return compact([titleEntry?.personTitle, titleEntry?.role]).join(" ");
}

function withTitle(displayName: string, titleBlock: string) {
  if (!titleBlock) return displayName;
  if (normalize(displayName).startsWith(normalize(titleBlock))) return displayName;
  return `${titleBlock} ${displayName}`;
}

function getUniversityName(
  author: AuthorItem,
  affiliations: string[],
  parsedAffiliations: ParsedAffiliation[],
  fallback: string
) {
  return (
    author.university?.trim() ||
    parsedAffiliations.find((item) => item.university)?.university?.trim() ||
    affiliations.find((item) => item.trim().length > 2)?.trim() ||
    fallback
  );
}

function getDepartmentLine(
  affiliations: string[],
  parsedAffiliations: ParsedAffiliation[],
  university: string,
  fallback: string
) {
  const departmentEntry = parsedAffiliations.find(
    (item) => item.department || item.faculty || item.role
  );
  const parsedLine = compact([
    departmentEntry?.department,
    departmentEntry?.faculty,
    departmentEntry?.role,
  ]).join(" • ");

  if (parsedLine) return parsedLine;

  const fallbackAffiliation = affiliations.find((item) => {
    const trimmed = item.trim();
    if (!trimmed || trimmed === university) {
      return false;
    }

    return !/\b(university|universitesi|universite|üniversite|academy|college|school)\b/i.test(
      trimmed,
    );
  });
  return fallbackAffiliation?.trim() || fallback;
}

function getLocationLine(author: AuthorItem, parsedAffiliations: ParsedAffiliation[]) {
  const city =
    author.city?.trim() || parsedAffiliations.find((item) => item.city)?.city?.trim() || "";
  const country =
    author.country?.trim() || parsedAffiliations.find((item) => item.country)?.country?.trim() || "";
  return compact([city, country]).join(", ");
}

function getDetailLine(author: AuthorItem) {
  if (author.recentWork?.trim()) return author.recentWork.trim();
  if (author.emailDomain?.trim()) return author.emailDomain.trim();

  const platforms = author.sourceProfiles
    ?.map((profile) => profile.platform?.trim())
    .filter((profile): profile is string => Boolean(profile));

  return compact(platforms ?? []).join(" • ");
}

function buildAuthorProfilePath({
  author,
  displayName,
  university,
  department,
  missingAffiliation,
}: {
  author: AuthorItem;
  displayName: string;
  university: string;
  department: string;
  missingAffiliation: string;
}) {
  const params = new URLSearchParams();

  if (author.dbAuthorId?.trim()) {
    params.set("id", author.dbAuthorId.trim());
  }

  if (displayName.trim()) {
    params.set("name", displayName.trim());
  }

  if (university.trim() && university !== missingAffiliation) {
    params.set("affiliation", university.trim());
  }

  if (
    department.trim() &&
    department !== university &&
    department !== missingAffiliation
  ) {
    params.set("department", department.trim());
  }

  if (author.city?.trim()) params.set("city", author.city.trim());
  if (author.country?.trim()) params.set("country", author.country.trim());

  return `/author?${params.toString()}`;
}

export default function AuthorsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme, toggle } = useTheme();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [resultTotal, setResultTotal] = useState(0);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const { filterData, filterLoading, filterError, filterReady } = useDiscoveryFilters({
    country: filters.country,
    city: filters.city,
  });

  const canSearch = useMemo(() => query.trim().length > 1, [query]);

  const runSearch = useCallback(async (value: string, nextFilters: FilterState) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const searchFilters: DiscoveryAuthorSearchFilters = {
        country: nextFilters.country || undefined,
        city: nextFilters.city || undefined,
        school: nextFilters.school || undefined,
      };
      const data = await api.discovery.searchAuthors(trimmed, SEARCH_LIMIT, searchFilters);
      setResults(data.items ?? []);
      setResultTotal(data.total ?? data.items?.length ?? 0);
    } catch (err) {
      setError(getApiErrorMessage(err, t("authors.search.error")));
      setResults([]);
      setResultTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q") ?? "";
    const nextFilters = {
      school: params.get("school") ?? "",
      city: params.get("city") ?? "",
      country: params.get("country") ?? "",
    };
    setFilters(nextFilters);
    if (q) {
      setQuery(q);
      void runSearch(q, nextFilters);
    }
  }, [runSearch]);

  useEffect(() => {
    if (!filterReady) return;
    if (filters.country && !filterData.countries.some((option) => option.value === filters.country)) {
      setFilters(emptyFilters);
    }
  }, [filterData.countries, filterReady, filters.country]);

  useEffect(() => {
    if (!filterReady) return;
    if (filters.city && !filterData.cities.some((option) => option.value === filters.city)) {
      setFilters((current) => ({
        ...current,
        city: "",
        school: "",
      }));
    }
  }, [filterData.cities, filterReady, filters.city]);

  useEffect(() => {
    if (!filterReady) return;
    if (filters.school && !filterData.schools.some((option) => option.value === filters.school)) {
      setFilters((current) => ({
        ...current,
        school: "",
      }));
    }
  }, [filterData.schools, filterReady, filters.school]);

  const onSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSearch) return;

    const trimmed = query.trim();
    const params = new URLSearchParams();
    params.set("q", trimmed);
    if (filters.school.trim()) params.set("school", filters.school.trim());
    if (filters.city.trim()) params.set("city", filters.city.trim());
    if (filters.country.trim()) params.set("country", filters.country.trim());
    router.replace(`/authors?${params.toString()}`);
    await runSearch(trimmed, filters);
  };

  const activeFilterLabels = useMemo(() => {
    const items = compact([
      filters.school
        ? `${t("home.search.school")}: ${findOptionLabel(filters.school, filterData.schools)}`
        : "",
      filters.city
        ? `${t("home.search.city")}: ${findOptionLabel(filters.city, filterData.cities)}`
        : "",
      filters.country
        ? `${t("home.search.country")}: ${findOptionLabel(filters.country, filterData.countries)}`
        : "",
    ]);
    return items;
  }, [filterData.cities, filterData.countries, filterData.schools, filters, t]);

  const displayedResults = useMemo(() => results, [results]);
  const visibleResultTotal = searched ? displayedResults.length : 0;

  return (
    <main className="authors-page">
      <div className="authors-shell">
        <header className="authors-topbar">
          <div className="authors-topbar-left">
            <Link href="/" className="authors-back" aria-label={t("authors.back")}>
              <ArrowLeft size={18} />
            </Link>
            <div className="authors-brand">
              <div className="authors-brand-icon">
                <UnipubLogo size={30} showText={false} variant="minimal" />
              </div>
              <div>
                <div className="authors-brand-title">{t("brand.name")}</div>
                <div className="authors-brand-sub">{t("brand.subtitle")}</div>
              </div>
            </div>
          </div>
          <div className="authors-topbar-actions">
            <LanguageSwitcher triggerClassName="home-lang-trigger authors-lang-trigger" />
            <button className="theme-toggle" type="button" onClick={toggle} aria-label="Toggle theme">
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </header>

        <section className="authors-search-shell">
          <form onSubmit={onSearch} className="authors-searchbar">
            <label className="authors-search-input">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("authors.search.placeholder")}
                aria-label={t("authors.search.placeholder")}
              />
            </label>
            <button type="submit" disabled={!canSearch || loading}>
              <span>{loading ? t("authors.loading") : t("authors.search.cta")}</span>
            </button>
          </form>
          <div className="authors-filter-grid">
            <label className="authors-filter-field">
              <span>{t("home.search.country")}</span>
              <select
                value={filters.country}
                onChange={(event) =>
                  setFilters({
                    country: event.target.value,
                    city: "",
                    school: "",
                  })
                }
                disabled={filterLoading && filterData.countries.length === 0}
              >
                <option value="">{t("common.all")}</option>
                {filterData.countries.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="authors-filter-field">
              <span>{t("home.search.city")}</span>
              <select
                value={filters.city}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    city: event.target.value,
                    school: "",
                  }))
                }
                disabled={filterLoading && filterData.cities.length === 0}
              >
                <option value="">{t("common.all")}</option>
                {filterData.cities.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="authors-filter-field">
              <span>{t("home.search.school")}</span>
              <select
                value={filters.school}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    school: event.target.value,
                  }))
                }
                disabled={filterLoading && filterData.schools.length === 0}
              >
                <option value="">{t("common.all")}</option>
                {filterData.schools.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="authors-filter-actions">
              <button
                type="button"
                className="authors-filter-clear"
                onClick={() => {
                  setFilters(emptyFilters);
                  if (!query.trim()) return;
                  router.replace(`/authors?q=${encodeURIComponent(query.trim())}`);
                  void runSearch(query, emptyFilters);
                }}
                disabled={!filters.country && !filters.city && !filters.school}
              >
                {t("common.clear")}
              </button>
            </div>
          </div>
          <div className="authors-search-meta">
            <div className="authors-search-count">
              <span>{visibleResultTotal}</span> {t("authors.count.label")}
            </div>
            {activeFilterLabels.length ? (
              <div className="authors-search-filters">
                <Filter size={14} />
                <span>{activeFilterLabels.join(" • ")}</span>
              </div>
            ) : null}
          </div>
          {filterError ? <div className="authors-filter-note">{filterError}</div> : null}
        </section>

        {loading ? (
          <section className="authors-loading authors-results-list" aria-live="polite">
            <div className="authors-loading-title">{t("authors.loading")}</div>
            <div className="authors-results-list">
              {Array.from({ length: 5 }).map((_, idx) => (
                <article key={idx} className="author-result-row skeleton">
                  <div className="author-result-main">
                    <div className="author-result-avatar" />
                    <div className="author-result-copy">
                      <div className="skeleton-line w70" />
                      <div className="skeleton-line w55" />
                      <div className="skeleton-line w40" />
                    </div>
                  </div>
                  <div className="author-result-side">
                    <div className="skeleton-line w30" />
                    <div className="skeleton-line w30" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {error ? <p className="authors-error">{error}</p> : null}
        {searched && !loading && results.length === 0 ? (
          <p className="authors-empty">{t("authors.empty")}</p>
        ) : null}

        {!loading ? (
          <section className="authors-results-list">
            {displayedResults.map((author, idx) => {
              const key = `${author.dbAuthorId ?? author.normalizedName ?? "author"}-${idx}`;
              const affiliations = author.affiliationRaw ?? [];
              const displayName = author.displayName ?? "Bilinmeyen Yazar";
              const parsedAffiliations = author.parsedAffiliations ?? [];
              const titleBlock = getTitleBlock(parsedAffiliations);
              const university = getUniversityName(
                author,
                affiliations,
                parsedAffiliations,
                t("authors.affiliation.missing")
              );
              const department = getDepartmentLine(
                affiliations,
                parsedAffiliations,
                university,
                t("authors.affiliation.missing")
              );
              const location = getLocationLine(author, parsedAffiliations);
              const detailLine = getDetailLine(author);
              const statusLabel = author.dbAuthorId ? t("authors.status.db") : t("authors.status.new");
              const missingAffiliation = t("authors.affiliation.missing");
              const profileHref = buildAuthorProfilePath({
                author,
                displayName,
                university,
                department,
                missingAffiliation,
              });

              return (
                <article key={key} className="author-result-row">
                  <div className="author-result-main">
                    <div className="author-result-avatar">{getInitials(displayName)}</div>

                    <div className="author-result-copy">
                      <div className="author-result-name-row">
                        <h3 className="author-result-name">
                          {withTitle(displayName, titleBlock)}
                        </h3>
                        {author.dbAuthorId ? (
                          <span className="author-result-verified" aria-label={statusLabel}>
                            <Check size={11} />
                          </span>
                        ) : null}
                      </div>

                      <p className="author-result-university">{university}</p>
                      <p className="author-result-department">{department}</p>

                      {location ? (
                        <div className="author-result-location">
                          <MapPin size={12} />
                          <span>{location}</span>
                        </div>
                      ) : null}

                      {detailLine ? (
                        <div className="author-result-detail">
                          <span className="author-result-detail-dot" />
                          <span>{detailLine}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="author-result-side">
                    <Link href={profileHref} className="author-result-action">
                      <span>{t("authors.profile")}</span>
                      <ChevronRight size={14} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </div>
    </main>
  );
}
