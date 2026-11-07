import type { CatalogAuthor } from "./catalog";
import type { DiscoveryAuthorItem, DiscoveryAuthorsResponse } from "./discovery";

type ParsedAffiliation = NonNullable<DiscoveryAuthorItem["parsedAffiliations"]>[number];
type SourceProfile = NonNullable<DiscoveryAuthorItem["sourceProfiles"]>[number];

export type CatalogAuthorMatchHints = {
  affiliation?: string;
  department?: string;
  city?: string;
  country?: string;
};

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

function getPrimaryUniversity(author: DiscoveryAuthorItem) {
  return (
    author.university?.trim() ||
    author.parsedAffiliations?.find((item) => item.university?.trim())?.university?.trim() ||
    ""
  );
}

function getEmailDomain(author: DiscoveryAuthorItem) {
  return (
    author.emailDomain?.trim() ||
    author.parsedAffiliations?.find((item) => item.emailDomain?.trim())?.emailDomain?.trim() ||
    ""
  );
}

function hasSharedSourceProfile(left: DiscoveryAuthorItem, right: DiscoveryAuthorItem) {
  const rightKeys = new Set(
    (right.sourceProfiles ?? []).map(
      (profile) => `${profile.platform}:${profile.externalAuthorId}`,
    ),
  );

  return (left.sourceProfiles ?? []).some((profile) =>
    rightKeys.has(`${profile.platform}:${profile.externalAuthorId}`),
  );
}

function mergeUniqueSourceProfiles(
  left: SourceProfile[] = [],
  right: SourceProfile[] = [],
) {
  const map = new Map<string, SourceProfile>();

  for (const profile of [...left, ...right]) {
    const key = `${profile.platform}:${profile.externalAuthorId}`;
    if (!map.has(key)) {
      map.set(key, profile);
    }
  }

  return Array.from(map.values());
}

function mergeUniqueParsedAffiliations(
  left: ParsedAffiliation[] = [],
  right: ParsedAffiliation[] = [],
) {
  const map = new Map<string, ParsedAffiliation>();

  for (const item of [...left, ...right]) {
    const key =
      item.raw?.trim().toLocaleLowerCase("tr-TR") ||
      [item.university, item.department, item.faculty, item.city, item.country]
        .filter(Boolean)
        .join("|")
        .toLocaleLowerCase("tr-TR");
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }

  return Array.from(map.values());
}

function scoreAuthorItemQuality(author: DiscoveryAuthorItem) {
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

function buildSplitSourceKey(author: DiscoveryAuthorItem) {
  return [
    normalizeIdentityName(author.displayName ?? ""),
    author.dbAuthorId?.trim() ?? "",
    normalizeIdentityValue(author.university) ?? "",
    normalizeIdentityValue(author.city) ?? "",
    normalizeIdentityValue(author.country) ?? "",
  ].join("|");
}

function filterSourceProfilesForCluster(
  author: DiscoveryAuthorItem,
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
function splitMergedAuthorItem(author: DiscoveryAuthorItem) {
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

function splitMergedAuthorResults(items: DiscoveryAuthorItem[]) {
  return items.flatMap((item) => splitMergedAuthorItem(item));
}

function shouldMergeAuthorItems(left: DiscoveryAuthorItem, right: DiscoveryAuthorItem) {
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

  const equivalentNames = haveEquivalentIdentityNames(
    left.displayName,
    right.displayName,
  );
  const leftUniversity = normalizeIdentityValue(getPrimaryUniversity(left));
  const rightUniversity = normalizeIdentityValue(getPrimaryUniversity(right));
  const leftLocation = normalizeIdentityValue(compact([left.city, left.country]).join(" "));
  const rightLocation = normalizeIdentityValue(compact([right.city, right.country]).join(" "));
  const sharedSourceProfile = hasSharedSourceProfile(left, right);

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

  if (!equivalentNames) {
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

function mergeAuthorItems(
  primary: DiscoveryAuthorItem,
  secondary: DiscoveryAuthorItem,
): DiscoveryAuthorItem {
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

function dedupeAuthorResults(items: DiscoveryAuthorItem[]) {
  const merged: DiscoveryAuthorItem[] = [];

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

export function sanitizeDiscoveryAuthorsResponse(
  response: DiscoveryAuthorsResponse,
): DiscoveryAuthorsResponse {
  const items = dedupeAuthorResults(splitMergedAuthorResults(response.items ?? []));

  return {
    ...response,
    items,
    total: items.length,
  };
}

function collectDiscoveryInstitutionValues(author: DiscoveryAuthorItem) {
  return compact([
    author.university,
    ...(author.affiliationRaw ?? []),
    ...(author.parsedAffiliations ?? []).flatMap((item) =>
      compact([item.university, item.raw]),
    ),
  ]);
}

function collectDiscoveryInstitutionCandidates(author: DiscoveryAuthorItem) {
  const rawInstitutionValues = compact([
    author.university,
    ...(author.affiliationRaw ?? []).flatMap((value) =>
      splitProfileFragments(value).filter(matchesInstitutionPattern),
    ),
    ...(author.parsedAffiliations ?? []).flatMap((item) =>
      compact([item.university, item.raw]).flatMap((value) =>
        splitProfileFragments(value).filter(matchesInstitutionPattern),
      ),
    ),
  ]);

  const normalizedValues = rawInstitutionValues
    .map((value) => normalizeCatalogMatchValue(value))
    .filter(Boolean)
    .sort((left, right) => left.length - right.length);
  const distinct: string[] = [];

  for (const value of normalizedValues) {
    if (
      distinct.some(
        (candidate) =>
          candidate === value || candidate.includes(value) || value.includes(candidate),
      )
    ) {
      continue;
    }

    distinct.push(value);
  }

  return distinct;
}

function collectDiscoveryDepartmentValues(author: DiscoveryAuthorItem) {
  return compact(
    (author.parsedAffiliations ?? []).flatMap((item) =>
      compact([item.department, item.faculty, item.raw]),
    ),
  );
}

function collectDiscoveryLocationValues(
  author: DiscoveryAuthorItem,
  field: "city" | "country",
) {
  return compact([
    author[field],
    ...(author.parsedAffiliations ?? []).map((item) => item[field]),
  ]);
}

function scoreDiscoveryAuthorIdentity(
  author: DiscoveryAuthorItem,
  name: string,
  hints: CatalogAuthorMatchHints = {},
) {
  const normalizedTarget = normalizeCatalogMatchValue(name);
  if (!normalizedTarget) return -1;

  const targetTokens = tokenizeCatalogMatchValue(normalizedTarget);
  const normalizedDisplayName = normalizeCatalogMatchValue(author.displayName ?? "");
  const displayNameTokens = tokenizeCatalogMatchValue(normalizedDisplayName);
  let displayNameScore = -1;

  if (normalizedDisplayName) {
    if (normalizedDisplayName === normalizedTarget) {
      displayNameScore = 140;
    } else if (scoreNameTokenMatch(targetTokens, displayNameTokens) > 0) {
      displayNameScore = 120;
    }
  }

  let aliasScore = -1;

  for (const alias of author.aliases ?? []) {
    const normalizedAlias = normalizeCatalogMatchValue(alias);
    if (!normalizedAlias) continue;

    if (normalizedAlias === normalizedTarget) {
      aliasScore = Math.max(aliasScore, 80);
      continue;
    }

    const aliasTokens = tokenizeCatalogMatchValue(normalizedAlias);
    if (scoreNameTokenMatch(targetTokens, aliasTokens) > 0) {
      aliasScore = Math.max(aliasScore, 60);
    }
  }

  const usesAliasOnly = displayNameScore < 0 && aliasScore > 0;
  const nameScore = Math.max(displayNameScore, aliasScore);

  if (nameScore < 0) {
    return -1;
  }

  let score = nameScore;
  const institutionValues = collectDiscoveryInstitutionValues(author);
  const institutionCandidates = collectDiscoveryInstitutionCandidates(author);
  const departmentValues = collectDiscoveryDepartmentValues(author);
  const cityValues = collectDiscoveryLocationValues(author, "city");
  const countryValues = collectDiscoveryLocationValues(author, "country");
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

  if (author.dbAuthorId?.trim()) {
    score += 20;
  }

  score += Math.min(author.sourceProfiles?.length ?? 0, 3);
  score += Math.min(author.parsedAffiliations?.length ?? 0, 2);
  score += Math.min(author.dbMatchScore ?? 0, 20);

  return score;
}

function normalizeCatalogMatchValue(value: string) {
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

function tokenizeCatalogMatchValue(value: string) {
  return normalizeCatalogMatchValue(value)
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
  return tokenizeCatalogMatchValue(value).filter(
    (token) => token.length > 1 && !GENERIC_IDENTITY_TOKENS.has(token),
  );
}

function matchesIdentityHint(hint: string, candidate: string) {
  const normalizedHint = normalizeCatalogMatchValue(hint);
  const normalizedCandidate = normalizeCatalogMatchValue(candidate);

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

function splitProfileFragments(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const tokens = [trimmed];
  const bulletParts = trimmed
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
  return /\b(university|universitesi|universite|üniversite|technical university|teknik üniversitesi|teknik universitesi|academy|college|school)\b/i.test(
    value,
  );
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
    .map((value) => normalizeCatalogMatchValue(value))
    .filter(Boolean)
    .sort((left, right) => left.length - right.length);
  const distinct: string[] = [];

  for (const value of normalizedValues) {
    if (
      distinct.some(
        (candidate) =>
          candidate === value || candidate.includes(value) || value.includes(candidate),
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
  const profileValue = field === "city" ? author.profile?.city : author.profile?.country;
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
  const normalizedTarget = normalizeCatalogMatchValue(name);
  if (!normalizedTarget) return -1;

  const targetTokens = tokenizeCatalogMatchValue(normalizedTarget);
  const normalizedFullName = normalizeCatalogMatchValue(author.fullName);
  const fullNameTokens = tokenizeCatalogMatchValue(normalizedFullName);
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
    const normalizedAlias = normalizeCatalogMatchValue(alias);
    if (!normalizedAlias) continue;

    if (normalizedAlias === normalizedTarget) {
      aliasScore = Math.max(aliasScore, 80);
      continue;
    }

    const aliasTokens = tokenizeCatalogMatchValue(normalizedAlias);
    if (scoreNameTokenMatch(targetTokens, aliasTokens) > 0) {
      aliasScore = Math.max(aliasScore, 60);
    }
  }

  const usesAliasOnly = fullNameScore < 0 && aliasScore > 0;
  const nameScore = Math.max(fullNameScore, aliasScore);

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

export function findBestDiscoveryAuthorMatch(
  authors: DiscoveryAuthorItem[],
  name: string,
  hints: CatalogAuthorMatchHints = {},
) {
  let best: DiscoveryAuthorItem | null = null;
  let bestScore = -1;

  for (const author of authors) {
    const score = scoreDiscoveryAuthorIdentity(author, name, hints);
    if (score > bestScore) {
      best = author;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}
