import type { CatalogAuthor, CatalogPublicationDateFilter, CatalogPublicationSyncResponse } from "@/api/platforms/catalog";
import type {
  Author,
  Publication,
  PublicationDateFilterOption,
  PublicationSourceLink,
  TranslateFn,
} from "./authorPage.types";

export const PLATFORM_LABELS: Record<string, string> = {
  serpapi_scholar: "Google Scholar",
  trdizin: "TR Dizin",
  scraper_pubmed: "PubMed",
  scraper_scopus: "Scopus",
  scopus_scraper: "Scopus",
};

function normalizeTrdizinTitleSpacing(value: string) {
  const normalized = value
    .trim()
    .replace(/([a-zçğıöşüâîû])([A-ZÇĞİÖŞÜÂÎÛ])/g, "$1 $2")
    .replace(/([0-9])([A-ZÇĞİÖŞÜÂÎÛ][a-zçğıöşüâîû])/g, "$1 $2")
    .replace(/\s+/g, " ");

  const [firstToken, ...restTokens] = normalized.split(" ");
  if (!firstToken || restTokens.length === 0) return normalized;

  const suffixMatch = firstToken.match(/^(.{4,})(of|for|and|with|from)$/i);
  if (suffixMatch) {
    const [, stem, suffix] = suffixMatch;
    return [stem, suffix.toLowerCase(), ...restTokens].join(" ");
  }

  const leadingArticleMatch = firstToken.match(/^(The)([a-zçğıöşüâîû].{3,})$/);
  if (leadingArticleMatch) {
    const [, article, nextWord] = leadingArticleMatch;
    return [article, nextWord, ...restTokens].join(" ");
  }

  return normalized;
}

export function formatPublicationTitle(publication: Publication) {
  const title = publication.title.trim();
  const hasTrdizinSource = publication.sourceRecords?.some(
    (record) => getCanonicalPlatformKey(record.platform) === "trdizin",
  );

  return hasTrdizinSource ? normalizeTrdizinTitleSpacing(title) : title;
}

export function getInitials(name: string) {
  const tokens = name
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  return tokens.map((item) => item[0]?.toUpperCase() ?? "").join("") || "AU";
}

export function compact(values: Array<string | undefined | null>) {
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

export function sanitizeAffiliation(value: string, fullName?: string) {
  let cleaned = value.trim();
  if (!cleaned) return "";

  cleaned = cleaned.replace(/\bVerified email at\b.*$/i, "").trim();
  cleaned = cleaned.replace(/\bDoğrulanmış e-?posta\b.*$/i, "").trim();

  const name = fullName?.trim();
  if (name) {
    const nameKey = name.toLocaleLowerCase("tr-TR");
    const cleanedKey = cleaned.toLocaleLowerCase("tr-TR");

    if (cleanedKey.startsWith(nameKey)) {
      cleaned = cleaned.slice(name.length).trim();
      cleaned = cleaned.replace(/^[,•\-–—\s]+/, "").trim();
    }
  }

  cleaned = cleaned.replace(/[,•\-–—\s]+$/, "").trim();
  return cleaned;
}

function normalizeProfileText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bverified email(?:\s+at)?\b/gi, "verified email")
    .replace(/\bdoğrulanmış e-?posta\b/gi, "verified email")
    .replace(/\be-?posta\b/gi, "email")
    .replace(/dept\./gi, "department")
    .replace(/[()]/g, " ")
    .replace(/[,:;|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProfileTokenKey(value: string) {
  return normalizeProfileText(value)
    .replace(/[^a-z0-9çğıöşü\s.-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function splitProfileFragments(value: string) {
  const base = sanitizeAffiliation(value);
  if (!base) return [];

  const tokens = [base];
  const bulletParts = base
    .split(/[•|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  tokens.push(...bulletParts);

  for (const part of bulletParts) {
    const commaParts = part
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (commaParts.length >= 2) {
      tokens.push(...commaParts);
    }
  }

  return compact(tokens);
}

function matchesInstitutionPattern(value: string) {
  return /\b(university|universitesi|universite|üniversite|technical university|teknik üniversitesi|teknik universitesi|academy)\b/i.test(
    value,
  );
}

function matchesFacultyPattern(value: string) {
  return /\b(faculty|fakültesi|fakultesi|institute|institut|enstitüsü|school of|college of)\b/i.test(
    value,
  );
}

function matchesDepartmentPattern(value: string) {
  return /\b(department|dept\.?|bölümü|bolumu|anabilim|programı|programi|division of)\b/i.test(
    value,
  );
}

function matchesLocationNoise(value: string) {
  return /^(turkiye|türkiye|turkey)$/i.test(value.trim());
}

function extractEmailValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const exactEmailMatch = trimmed.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );
  if (exactEmailMatch?.[0]) {
    return `Email: ${exactEmailMatch[0]}`;
  }

  const verifiedMatch = trimmed.match(
    /\b(?:verified email|email)\s*:?\s*([A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  );
  if (verifiedMatch?.[1]) {
    return `Verified email: ${verifiedMatch[1]}`;
  }

  return undefined;
}

function getProfileSourceValues(author: Author | null) {
  const profile = author?.profile;
  const affiliationBlocks = compact(
    (author?.affiliations ?? []).map((item) =>
      sanitizeAffiliation(item, author?.fullName),
    ),
  );
  const affiliationFragments = compact(
    affiliationBlocks.flatMap((item) => splitProfileFragments(item)),
  );
  const rawBlocks = compact([
    ...(author?.profileSummaryParts ?? []),
    ...affiliationBlocks,
  ]).map((item) => sanitizeAffiliation(item, author?.fullName));
  const rawFragments = compact(rawBlocks.flatMap((item) => splitProfileFragments(item)));

  return {
    profile,
    affiliationBlocks,
    affiliationFragments,
    rawBlocks,
    rawFragments,
  };
}

function candidateSupportScore(candidate: string, sourceValues: string[]) {
  const normalizedCandidate = normalizeProfileTokenKey(candidate);
  if (!normalizedCandidate) return 0;

  return sourceValues.reduce((score, sourceValue) => {
    const normalizedSource = normalizeProfileTokenKey(sourceValue);
    if (!normalizedSource) return score;
    if (normalizedSource === normalizedCandidate) return score + 9;
    if (normalizedSource.includes(normalizedCandidate)) return score + 5;
    if (normalizedCandidate.includes(normalizedSource)) return score + 2;
    return score;
  }, 0);
}

function pickBestInstitution(author: Author | null) {
  const {
    profile,
    affiliationBlocks,
    affiliationFragments,
    rawBlocks,
    rawFragments,
  } = getProfileSourceValues(author);
  const firstAffiliation = affiliationBlocks[0];
  const candidates = compact([
    author?.university,
    profile?.institutionName,
    ...affiliationFragments.filter(matchesInstitutionPattern),
    ...affiliationBlocks.filter(matchesInstitutionPattern),
    ...rawFragments.filter(matchesInstitutionPattern),
    ...rawBlocks.filter(matchesInstitutionPattern),
  ]);

  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    const leftScore =
      candidateSupportScore(left, rawBlocks) +
      candidateSupportScore(left, affiliationBlocks) +
      (firstAffiliation &&
      normalizeProfileTokenKey(firstAffiliation).includes(
        normalizeProfileTokenKey(left),
      )
        ? 24
        : 0) +
      (affiliationFragments.some(
        (item) =>
          normalizeProfileTokenKey(item) === normalizeProfileTokenKey(left),
      )
        ? 18
        : 0) +
      (normalizeProfileTokenKey(left) === normalizeProfileTokenKey(author?.university ?? "")
        ? 8
        : 0) +
      (normalizeProfileTokenKey(left) ===
      normalizeProfileTokenKey(profile?.institutionName ?? "")
        ? 2
        : 0) +
      (matchesInstitutionPattern(left) ? 5 : 0) -
      (matchesDepartmentPattern(left) ? 7 : 0) -
      (matchesFacultyPattern(left) ? 4 : 0) -
      ((left.match(/,/g) ?? []).length * 3);
    const rightScore =
      candidateSupportScore(right, rawBlocks) +
      candidateSupportScore(right, affiliationBlocks) +
      (firstAffiliation &&
      normalizeProfileTokenKey(firstAffiliation).includes(
        normalizeProfileTokenKey(right),
      )
        ? 24
        : 0) +
      (affiliationFragments.some(
        (item) =>
          normalizeProfileTokenKey(item) === normalizeProfileTokenKey(right),
      )
        ? 18
        : 0) +
      (normalizeProfileTokenKey(right) === normalizeProfileTokenKey(author?.university ?? "")
        ? 8
        : 0) +
      (normalizeProfileTokenKey(right) ===
      normalizeProfileTokenKey(profile?.institutionName ?? "")
        ? 2
        : 0) +
      (matchesInstitutionPattern(right) ? 5 : 0) -
      (matchesDepartmentPattern(right) ? 7 : 0) -
      (matchesFacultyPattern(right) ? 4 : 0) -
      ((right.match(/,/g) ?? []).length * 3);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.length - right.length;
  })[0];
}

function pickBestProfileField(
  structuredValue: string | undefined,
  candidates: string[],
  predicate: (value: string) => boolean,
) {
  const cleanedStructured = structuredValue?.trim();
  if (cleanedStructured) {
    return titleCaseCsv(cleanedStructured);
  }

  const match = candidates.find((item) => predicate(item));
  return match ? titleCaseCsv(match) : undefined;
}

function shouldSkipDetailPart(
  value: string,
  primaryAffiliation: string | undefined,
  existing: string[],
) {
  const normalizedValue = normalizeProfileTokenKey(value);
  if (!normalizedValue || matchesLocationNoise(value)) {
    return true;
  }

  if (primaryAffiliation) {
    const normalizedPrimary = normalizeProfileTokenKey(primaryAffiliation);
    if (
      normalizedPrimary === normalizedValue ||
      normalizedValue.includes(normalizedPrimary) ||
      normalizedPrimary.includes(normalizedValue)
    ) {
      return true;
    }
  }

  return existing.some((item) => {
    const normalizedItem = normalizeProfileTokenKey(item);
    return (
      normalizedItem === normalizedValue ||
      normalizedItem.includes(normalizedValue) ||
      normalizedValue.includes(normalizedItem)
    );
  });
}

export function getAuthorProfileDetails(author: Author | null) {
  const { profile, rawBlocks, rawFragments } = getProfileSourceValues(author);
  const sanitizedAffiliations = compact(
    (author?.affiliations ?? []).map((item) =>
      sanitizeAffiliation(item, author?.fullName),
    ),
  );
  const primaryAffiliation =
    pickBestInstitution(author) ??
    sanitizedAffiliations[0] ??
    author?.profile?.institutionName ??
    author?.university ??
    author?.profileSummaryParts?.[0];
  const primaryKey = primaryAffiliation?.toLocaleLowerCase("tr-TR") ?? "";
  const affiliationKeys = sanitizedAffiliations.map((item) =>
    item.toLocaleLowerCase("tr-TR"),
  );
  const additionalParts = compact(author?.profileSummaryParts ?? [])
    .filter((item) => {
      const key = item.toLocaleLowerCase("tr-TR");
      return (
        key !== primaryKey &&
        !primaryKey.includes(key) &&
        !affiliationKeys.some(
          (affiliationKey) =>
            affiliationKey.includes(key) || key.includes(affiliationKey),
        )
      );
    })
    .slice(0, 4);
  const title = pickBestProfileField(
    profile?.title,
    rawFragments.filter((item): item is string => Boolean(item)),
    () => true,
  );
  const email = pickBestProfileField(
    profile?.email
      ? `Email: ${profile.email}`
      : profile?.emailDomain
        ? `Verified email: ${profile.emailDomain}`
        : undefined,
    compact([
      ...rawBlocks.map((item) => extractEmailValue(item)),
      ...rawFragments.map((item) => extractEmailValue(item)),
    ]),
    () => true,
  );
  const faculty = pickBestProfileField(
    profile?.faculty,
    rawFragments,
    (value) =>
      matchesFacultyPattern(value) &&
      !matchesDepartmentPattern(value) &&
      !matchesInstitutionPattern(value),
  );
  const department = pickBestProfileField(
    profile?.department,
    rawFragments,
    (value) => matchesDepartmentPattern(value),
  );
  const location = compact([
    profile?.city ?? author?.city,
    profile?.country ?? author?.country,
  ]).join(", ");
  const detailParts: string[] = [];

  for (const candidate of [
    title,
    email,
    faculty,
    department,
    ...additionalParts,
    location,
  ]) {
    if (!candidate || shouldSkipDetailPart(candidate, primaryAffiliation, detailParts)) {
      continue;
    }

    detailParts.push(candidate);
    if (detailParts.length >= 4) break;
  }

  if (detailParts.length === 0) {
    for (const candidate of sanitizedAffiliations) {
      if (shouldSkipDetailPart(candidate, primaryAffiliation, detailParts)) {
        continue;
      }

      detailParts.push(candidate);
      if (detailParts.length >= 2) break;
    }
  }

  return {
    primaryAffiliation,
    detailParts,
  };
}

function normalizeAuthorMatchValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CatalogAuthorMatchHints = {
  affiliation?: string;
  department?: string;
  city?: string;
  country?: string;
};

const GENERIC_IDENTITY_TOKENS = new Set([
  "academy",
  "anabilim",
  "bolumu",
  "college",
  "department",
  "dept",
  "division",
  "enstitusu",
  "faculty",
  "fakultesi",
  "institute",
  "of",
  "okulu",
  "programi",
  "school",
  "the",
  "university",
  "universite",
  "universitesi",
]);

function tokenizeAuthorMatchValue(value: string) {
  return normalizeAuthorMatchValue(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function haveSameNameTokens(left: string[], right: string[]) {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((token) => right.includes(token))
  );
}

function scoreNameTokenMatch(targetTokens: string[], candidateTokens: string[]) {
  if (targetTokens.length === 0 || candidateTokens.length === 0) {
    return -1;
  }

  return haveSameNameTokens(targetTokens, candidateTokens) ? 1 : -1;
}

function tokenizeIdentityHint(value: string) {
  return tokenizeAuthorMatchValue(value).filter(
    (token) => token.length > 1 && !GENERIC_IDENTITY_TOKENS.has(token),
  );
}

function matchesIdentityHint(hint: string, candidate: string) {
  const normalizedHint = normalizeAuthorMatchValue(hint);
  const normalizedCandidate = normalizeAuthorMatchValue(candidate);

  if (!normalizedHint || !normalizedCandidate) return false;
  if (normalizedHint === normalizedCandidate) return true;
  if (normalizedHint.length >= 8 && normalizedCandidate.includes(normalizedHint)) return true;
  if (normalizedCandidate.length >= 8 && normalizedHint.includes(normalizedCandidate)) return true;

  const hintTokens = tokenizeIdentityHint(normalizedHint);
  const candidateTokens = tokenizeIdentityHint(normalizedCandidate);
  if (hintTokens.length === 0 || candidateTokens.length === 0) return false;

  const sharedTokens = hintTokens.filter((token) => candidateTokens.includes(token));
  return sharedTokens.length >= 2;
}

function collectCatalogInstitutionValues(author: CatalogAuthor) {
  return compact([
    author.university,
    author.profile?.institutionName,
    ...(author.affiliations ?? []),
  ]);
}

function collectCatalogInstitutionCandidates(author: CatalogAuthor) {
  const rawInstitutionValues = compact([
    author.university,
    author.profile?.institutionName,
    ...(author.affiliations ?? []).flatMap((value) =>
      splitProfileFragments(value).filter(matchesInstitutionPattern),
    ),
  ]);

  const normalizedValues = rawInstitutionValues
    .map((value) => normalizeAuthorMatchValue(value))
    .filter(Boolean)
    .sort((left, right) => left.length - right.length);
  const distinct: string[] = [];

  for (const value of normalizedValues) {
    if (
      distinct.some(
        (candidate) => candidate === value || candidate.includes(value) || value.includes(candidate),
      )
    ) {
      continue;
    }

    distinct.push(value);
  }

  return distinct;
}

function collectCatalogDepartmentValues(author: CatalogAuthor) {
  return compact([
    author.profile?.faculty,
    author.profile?.department,
    ...(author.affiliations ?? []),
  ]);
}

function collectCatalogLocationValues(author: CatalogAuthor, field: "city" | "country") {
  const profileValue =
    field === "city" ? author.profile?.city : author.profile?.country;

  return compact([author[field], profileValue]);
}

function looksInstitutionHint(value: string) {
  return /\b(university|universitesi|universite|üniversite|academy|college|school)\b/i.test(
    value,
  );
}

function scoreCatalogAuthorIdentity(
  author: CatalogAuthor,
  name: string,
  hints: CatalogAuthorMatchHints = {},
) {
  const normalizedTarget = normalizeAuthorMatchValue(name);
  if (!normalizedTarget) return -1;

  const targetTokens = tokenizeAuthorMatchValue(normalizedTarget);
  const normalizedFullName = normalizeAuthorMatchValue(author.fullName);
  const fullNameTokens = tokenizeAuthorMatchValue(normalizedFullName);
  let fullNameScore = -1;

  if (normalizedFullName) {
    if (normalizedFullName === normalizedTarget) {
      fullNameScore = 140;
    } else if (scoreNameTokenMatch(targetTokens, fullNameTokens) > 0) {
      fullNameScore = 120;
    }
  }

  let aliasScore = -1;

  for (const alias of author.aliases ?? []) {
    const normalizedAlias = normalizeAuthorMatchValue(alias);
    if (!normalizedAlias) continue;

    if (normalizedAlias === normalizedTarget) {
      aliasScore = Math.max(aliasScore, 80);
      continue;
    }

    const aliasTokens = tokenizeAuthorMatchValue(normalizedAlias);
    if (scoreNameTokenMatch(targetTokens, aliasTokens) > 0) {
      aliasScore = Math.max(aliasScore, 60);
    }
  }

  const usesAliasOnly = fullNameScore < 0 && aliasScore > 0;
  let nameScore = Math.max(fullNameScore, aliasScore);

  if (nameScore < 0) {
    return -1;
  }

  let score = nameScore;
  const institutionValues = collectCatalogInstitutionValues(author);
  const institutionCandidates = collectCatalogInstitutionCandidates(author);
  const departmentValues = collectCatalogDepartmentValues(author);
  const cityValues = collectCatalogLocationValues(author, "city");
  const countryValues = collectCatalogLocationValues(author, "country");
  let hintMatches = 0;

  const affiliationHint = hints.affiliation?.trim() ?? "";
  if (affiliationHint && institutionValues.length > 0) {
    if (
      looksInstitutionHint(affiliationHint) &&
      institutionCandidates.length > 1 &&
      institutionCandidates.some((value) => matchesIdentityHint(affiliationHint, value)) &&
      institutionCandidates.some((value) => !matchesIdentityHint(affiliationHint, value))
    ) {
      return -1;
    }

    if (institutionValues.some((value) => matchesIdentityHint(affiliationHint, value))) {
      score += 30;
      hintMatches += 1;
    } else if (looksInstitutionHint(affiliationHint)) {
      return -1;
    }
  }

  const departmentHint = hints.department?.trim() ?? "";
  if (departmentHint && departmentValues.length > 0) {
    if (departmentValues.some((value) => matchesIdentityHint(departmentHint, value))) {
      score += 12;
      hintMatches += 1;
    }
  }

  const cityHint = hints.city?.trim() ?? "";
  if (cityHint && cityValues.length > 0) {
    if (cityValues.some((value) => matchesIdentityHint(cityHint, value))) {
      score += 6;
      hintMatches += 1;
    }
  }

  const countryHint = hints.country?.trim() ?? "";
  if (countryHint && countryValues.length > 0) {
    if (countryValues.some((value) => matchesIdentityHint(countryHint, value))) {
      score += 4;
      hintMatches += 1;
    }
  }

  if (usesAliasOnly && hintMatches === 0) {
    return -1;
  }

  score += Math.min(author.sourceProfiles?.length ?? 0, 3);
  score += Math.min(author.affiliations?.length ?? 0, 2);

  return score;
}

export function doesCatalogAuthorMatchIdentity(
  author: CatalogAuthor,
  name: string,
  hints: CatalogAuthorMatchHints = {},
) {
  return scoreCatalogAuthorIdentity(author, name, hints) > 0;
}

export function findBestCatalogAuthorMatch(
  authors: CatalogAuthor[],
  name: string,
  hints: CatalogAuthorMatchHints = {},
) {
  let best: CatalogAuthor | null = null;
  let bestScore = -1;

  for (const author of authors) {
    const score = scoreCatalogAuthorIdentity(author, name, hints);
    if (score > bestScore) {
      best = author;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

export function formatPublicationDate(
  publication: Publication,
  locale: string,
  t: TranslateFn,
) {
  if (!publication.publishedAt && !publication.publishedYear) {
    return t("common.not_found");
  }

  if (publication.publishedAt) {
    const date = new Date(publication.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      const currentYear = new Date().getUTCFullYear() + 1;

      if (year >= 1000 && year <= currentYear) {
        const month = date.getUTCMonth();
        const day = date.getUTCDate();

        if (
          publication.publishedYear &&
          publication.publishedYear === year &&
          month === 0 &&
          day === 1
        ) {
          return String(publication.publishedYear);
        }

        return new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }).format(date);
      }
    }
  }

  return publication.publishedYear ? String(publication.publishedYear) : t("common.not_found");
}

function getCanonicalPlatformKey(platform: string) {
  const normalized = platform.trim().toLocaleLowerCase("tr-TR");

  if (normalized === "scraper_scopus" || normalized === "scopus_scraper") {
    return "scopus";
  }

  if (normalized === "serpapi_scholar" || normalized === "google_scholar") {
    return "google-scholar";
  }

  if (normalized === "scraper_pubmed" || normalized === "pubmed") {
    return "pubmed";
  }

  return normalized;
}

function getSafeExternalUrl(rawUrl?: string) {
  const value = rawUrl?.trim();
  if (!value) return undefined;

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    new URL(normalized);
    return normalized;
  } catch {
    return undefined;
  }
}

function splitAuthorsFromText(authorsText?: string) {
  const raw = authorsText?.trim();
  if (!raw) return [];

  if (raw.includes(";")) {
    return raw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (/\sand\s/i.test(raw)) {
    return raw
      .split(/\sand\s/i)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [raw];
}

export function formatAuthors(publication: Publication) {
  const fromArray = (publication.authors ?? []).map((item) => item.trim()).filter(Boolean);
  const authors = fromArray.length > 0 ? fromArray : splitAuthorsFromText(publication.authorsText);

  if (authors.length === 0) return null;
  return compact(authors).join(", ");
}

export function getPublicationSourceLinks(
  publication: Publication,
): PublicationSourceLink[] {
  const byPlatform = new Map<string, PublicationSourceLink>();

  for (const item of publication.sourceRecords ?? []) {
    const key = getCanonicalPlatformKey(item.platform);
    const label = PLATFORM_LABELS[item.platform] ?? item.platform;
    const url = getSafeExternalUrl(item.sourceUrl);
    const existing = byPlatform.get(key);

    if (!existing || (!existing.url && url)) {
      byPlatform.set(key, { key, label, url });
    }
  }

  return Array.from(byPlatform.values());
}

export function getPublicationYear(publication: Publication): number | null {
  if (
    typeof publication.publishedYear === "number" &&
    publication.publishedYear > 0
  ) {
    return publication.publishedYear;
  }

  if (publication.publishedAt) {
    const date = new Date(publication.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      return date.getUTCFullYear();
    }
  }

  return null;
}

export function getPublicationSortTimestamp(publication: Publication) {
  if (publication.publishedAt) {
    const date = new Date(publication.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  const year = getPublicationYear(publication);
  if (year) {
    return Date.UTC(year, 0, 1);
  }

  return 0;
}

export function isPublicationWithinDateFilter(
  publication: Publication,
  dateFilter: CatalogPublicationDateFilter,
) {
  if (dateFilter === "all") return true;

  const yearsBack = Number(dateFilter);
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setUTCFullYear(now.getUTCFullYear() - yearsBack);

  if (publication.publishedAt) {
    const publishedAt = new Date(publication.publishedAt);
    if (!Number.isNaN(publishedAt.getTime())) {
      return publishedAt.getTime() >= cutoffDate.getTime();
    }
  }

  const publicationYear = getPublicationYear(publication);
  if (publicationYear === null) return false;

  return publicationYear >= now.getUTCFullYear() - yearsBack;
}

export function formatSyncDate(
  syncResult: CatalogPublicationSyncResponse | null,
  locale: string,
  t: TranslateFn,
) {
  if (!syncResult?.syncedAt) {
    return t("author.publications.sync.not_yet");
  }

  const date = new Date(syncResult.syncedAt);
  if (Number.isNaN(date.getTime())) {
    return t("author.publications.sync.not_yet");
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getPublicationDateFilters(
  t: TranslateFn,
): PublicationDateFilterOption[] {
  return [
    { value: "all", label: t("common.all") },
    { value: "1", label: t("author.publications.filter.last_1y") },
    { value: "3", label: t("author.publications.filter.last_3y") },
    { value: "5", label: t("author.publications.filter.last_5y") },
  ];
}
