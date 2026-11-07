export type InstitutionNameInput = {
  name?: string | null;
  platform?: string | null;
  city?: string | null;
  country?: string | null;
  confidence?: number | null;
};

export type InstitutionPlatformAlias = {
  platform: string;
  names: string[];
};

export type ResolvedInstitutionIdentity = {
  canonicalName: string;
  normalizedKey: string;
  aliases: string[];
  matchKeys: string[];
  city?: string;
  country?: string;
  platformAliases: InstitutionPlatformAlias[];
};

type InstitutionProfile = {
  rawName: string;
  normalized: string;
  compact: string;
  tokens: string[];
  significantTokens: string[];
  hasUniversityToken: boolean;
  uppercaseAcronyms: string[];
  acronymCandidates: string[];
};

const GENERIC_TOKENS = new Set([
  'university',
  'universite',
  'faculty',
  'fakultesi',
  'enstitusu',
  'institute',
  'institutes',
  'college',
  'school',
  'department',
  'dept',
  'merkezi',
  'center',
  'centre',
  've',
  'of',
  'the',
  'and',
  'for',
  'at',
]);

const AMBIGUOUS_SIGNIFICANT_TOKENS = new Set([
  'technical',
  'teknik',
  'technology',
  'teknoloji',
  'medical',
  'medicine',
  'health',
  'science',
  'sciences',
  'engineering',
  'muhendislik',
  'muhendisligi',
  'polytechnic',
]);

const TOKEN_ALIASES: Record<string, string> = {
  universitesi: 'university',
  universite: 'university',
  university: 'university',
  un: 'university',
  fakultesi: 'faculty',
  faculty: 'faculty',
  enstitusu: 'institute',
  institute: 'institute',
  institutes: 'institute',
  merkezi: 'center',
  centre: 'center',
};

const NOISE_PATTERNS = [
  /verified email/i,
  /dogrulanmis e-?posta/i,
  /üzerinde doğrulanmış e-?posta/i,
  /bilinmeyen bağlantı/i,
  /unknown affiliation/i,
  /makaleler/i,
  /alinti yapanlar/i,
  /katkida/i,
  /cited by/i,
  /google scholar/i,
];

function normalizeForInstitutionSearch(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripInstitutionNoise(value: string) {
  let cleaned = value.replace(/\s+/g, ' ').trim();

  cleaned = cleaned.replace(/\b(?:Univ\.?)\b/gi, 'University');
  cleaned = cleaned.replace(/\bÜn\.?\b/gu, 'Üniversitesi');
  cleaned = cleaned.replace(/\bUniversite\.?\b/gi, 'Universitesi');

  for (const marker of [
    /\s+-\s+verified email at .*/i,
    /\s+verified email at .*/i,
    /\s+üzerinde doğrulanmış e-?posta adresine sahip.*/i,
    /\s+dogrulanmis e-?posta adresine sahip.*/i,
    /\s+makaleler.*/i,
    /\s+alinti yapanlar.*/i,
    /\s+katkida.*/i,
  ]) {
    cleaned = cleaned.replace(marker, '').trim();
  }

  return cleaned.replace(/[.;,\s]+$/g, '').trim();
}

function looksLikeInstitutionNoise(value: string) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

function hasInstitutionToken(value: string) {
  return normalizeForInstitutionSearch(value)
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .includes('university');
}

function isGenericInstitutionValue(value: string) {
  return (
    normalizeForInstitutionSearch(value)
      .split(' ')
      .map((token) => TOKEN_ALIASES[token] ?? token)
      .join(' ') === 'university'
  );
}

function normalizeInstitutionCandidate(value: string) {
  return stripInstitutionNoise(value).replace(/\s+/g, ' ').trim();
}

function findInstitutionSubstring(value: string) {
  const patterns = [
    /\b((?:University|Universitesi|Üniversitesi)(?:\s+of)?(?:\s+[A-ZÇĞİÖŞÜA-Za-zçğıöşü.'-]+){1,8})(?=$|[\s,.;])/gu,
    /([A-ZÇĞİÖŞÜA-Za-zçğıöşü.'-]+(?:\s+[A-ZÇĞİÖŞÜA-Za-zçğıöşü.'-]+){0,8}\s+(?:University|Universitesi|Üniversitesi))(?:$|[\s,.;])/gu,
  ];

  let best: string | null = null;
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const candidate = normalizeInstitutionCandidate(match[1] ?? '');
      if (!candidate) {
        continue;
      }
      if (!best || candidate.length > best.length) {
        best = candidate;
      }
    }
  }

  return best;
}

function collectInstitutionSegments(value: string) {
  const segments = new Set<string>();
  const push = (candidate?: string | null) => {
    const normalized = candidate?.trim();
    if (normalized) {
      segments.add(normalized);
    }
  };

  for (const sentencePart of value.split(/(?:\.\s+|;\s+|\|\s+|\n+)/g)) {
    push(sentencePart);
    for (const commaPart of sentencePart.split(/\s*,\s*/g)) {
      push(commaPart);
    }
  }

  return Array.from(segments);
}

function pickBestExtractedInstitutionCandidate(candidates: string[]) {
  const unique = [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return null;
  }

  return unique.sort((left, right) => {
    const scoreDiff = scoreInstitutionNameCandidate(right) - scoreInstitutionNameCandidate(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.length - right.length;
  })[0];
}

export function isLikelyInstitutionName(value: string) {
  const cleaned = normalizeInstitutionCandidate(value);
  if (!cleaned) {
    return false;
  }
  if (looksLikeInstitutionNoise(cleaned)) {
    return false;
  }
  if (isGenericInstitutionValue(cleaned)) {
    return false;
  }
  if (!hasInstitutionToken(cleaned)) {
    return false;
  }

  const profile = buildInstitutionProfile(cleaned);
  if (!profile) {
    return false;
  }

  return profile.significantTokens.length >= 1;
}

export function extractInstitutionNameCandidate(value: string) {
  const cleaned = normalizeInstitutionCandidate(value);
  if (!cleaned || looksLikeInstitutionNoise(cleaned)) {
    return null;
  }

  const segments = collectInstitutionSegments(cleaned);
  const extractedCandidates = segments
    .map((segment) => findInstitutionSubstring(segment))
    .filter(
      (candidate): candidate is string => !!candidate && isLikelyInstitutionName(candidate),
    );
  const extractedBest = pickBestExtractedInstitutionCandidate(extractedCandidates);
  if (extractedBest) {
    return extractedBest;
  }

  const segmentedCandidates = segments.filter((candidate): candidate is string =>
    isLikelyInstitutionName(candidate),
  );
  const segmentedBest = pickBestExtractedInstitutionCandidate(segmentedCandidates);
  if (segmentedBest) {
    return segmentedBest;
  }

  const extracted = findInstitutionSubstring(cleaned);
  if (extracted && isLikelyInstitutionName(extracted)) {
    return extracted;
  }

  if (isLikelyInstitutionName(cleaned)) {
    return cleaned;
  }

  return null;
}

function buildInstitutionAcronymCandidates(
  tokens: string[],
  significantTokens: string[],
  hasUniversityToken: boolean,
  uppercaseAcronyms: string[],
) {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized || normalized.length < 2 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  for (const acronym of uppercaseAcronyms) {
    push(acronym);
  }

  let compressedAcronym: string | null = null;
  let initialsAcronym: string | null = null;

  if (significantTokens.length >= 2) {
    const firstToken = significantTokens[0] ?? '';
    const lastToken = significantTokens[significantTokens.length - 1] ?? '';
    if (firstToken.length >= 2 && lastToken.length >= 1) {
      compressedAcronym = `${firstToken.slice(0, 2)}${lastToken[0]}`;
    }

    const initials = significantTokens.map((token) => token[0]).join('');
    if (initials.length >= 2 && initials.length <= 4) {
      initialsAcronym = initials;
    }
  }

  if (hasUniversityToken) {
    const universityIndex = tokens.indexOf('university');
    if (universityIndex > 0) {
      const previousToken = tokens[universityIndex - 1] ?? '';
      if (previousToken.length >= 3 && previousToken.length <= 6) {
        push(previousToken);
      }
    }
    if (compressedAcronym) {
      push(`${compressedAcronym}u`);
    }
    if (initialsAcronym) {
      push(`${initialsAcronym}u`);
    }
  }

  if (compressedAcronym) {
    push(compressedAcronym);
  }
  if (initialsAcronym) {
    push(initialsAcronym);
  }

  return candidates;
}

function buildInstitutionProfile(name: string): InstitutionProfile | null {
  const rawName = name.replace(/\s+/g, ' ').trim();
  if (!rawName) {
    return null;
  }

  const normalized = normalizeForInstitutionSearch(rawName);
  if (!normalized) {
    return null;
  }

  const uppercaseAcronyms = Array.from(
    rawName.matchAll(/\b[A-ZÇĞİÖŞÜ]{2,6}\b/g),
    (match) => normalizeForInstitutionSearch(match[0] ?? ''),
  ).filter(Boolean);

  const tokens = normalized
    .split(' ')
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter(Boolean);

  const significantTokens = tokens.filter(
    (token) => token.length > 1 && !GENERIC_TOKENS.has(token),
  );
  const acronymCandidates = buildInstitutionAcronymCandidates(
    tokens,
    significantTokens,
    tokens.includes('university'),
    uppercaseAcronyms,
  );

  return {
    rawName,
    normalized: tokens.join(' '),
    compact: tokens.join(''),
    tokens,
    significantTokens,
    hasUniversityToken: tokens.includes('university'),
    uppercaseAcronyms,
    acronymCandidates,
  };
}

function buildMatchKeysFromProfile(profile: InstitutionProfile) {
  const keys = new Set<string>();
  keys.add(`norm:${profile.normalized}`);
  if (profile.compact) {
    keys.add(`compact:${profile.compact}`);
  }

  const core = profile.significantTokens.join(' ');
  if (core) {
    keys.add(`core:${core}`);
    keys.add(`corecompact:${profile.significantTokens.join('')}`);
  }

  if (profile.significantTokens.length >= 3) {
    const tail = profile.significantTokens.slice(1).join(' ');
    if (tail) {
      keys.add(`tail:${tail}`);
      keys.add(`tailcompact:${profile.significantTokens.slice(1).join('')}`);
    }
  }

  if (profile.significantTokens.length >= 2) {
    const initials = profile.significantTokens.map((token) => token[0]).join('');
    if (initials.length >= 2) {
      keys.add(`sig:${initials}`);
      if (profile.hasUniversityToken) {
        keys.add(`sig:${initials}u`);
      }
    }
  }

  if (profile.significantTokens.length >= 1) {
    const firstToken = profile.significantTokens[0] ?? '';
    const lastToken =
      profile.significantTokens[profile.significantTokens.length - 1] ?? '';
    if (firstToken.length >= 2 && lastToken) {
      const compressed = `${firstToken.slice(0, 2)}${lastToken[0]}`;
      if (compressed.length >= 3) {
        keys.add(`abbr:${compressed}`);
        if (profile.hasUniversityToken) {
          keys.add(`abbr:${compressed}u`);
        }
      }
    }
  }

  for (const acronym of profile.acronymCandidates) {
    keys.add(`abbr:${acronym}`);
    keys.add(`abbrtoken:${acronym}`);
  }

  return Array.from(keys);
}

function buildNormalizedKeyFromProfile(profile: InstitutionProfile) {
  const baseTokens =
    profile.significantTokens.length > 0 ? profile.significantTokens : profile.tokens;
  const tokens = [...baseTokens];
  if (profile.hasUniversityToken && !tokens.includes('university')) {
    tokens.push('university');
  }
  return tokens.join('-');
}

function scoreInstitutionNameCandidate(name: string) {
  const trimmed = name.trim();
  const profile = buildInstitutionProfile(trimmed);
  if (!profile) {
    return 0;
  }

  const uppercaseAcronymPenalty = profile.uppercaseAcronyms.length > 0 ? 20 : 0;
  const turkishCharBonus = /[çğıöşüÇĞİÖŞÜ]/.test(trimmed) ? 10 : 0;
  const localSuffixBonus = /(üniversitesi|universitesi)\b/.test(trimmed) ? 10 : 0;
  const titleCaseBonus = /^[A-ZÇĞİÖŞÜ0-9]/.test(trimmed) ? 8 : -10;

  return (
    profile.significantTokens.length * 18 +
    Math.min(trimmed.length, 72) / 4 +
    (profile.hasUniversityToken ? 10 : 0) +
    turkishCharBonus +
    localSuffixBonus +
    titleCaseBonus -
    uppercaseAcronymPenalty
  );
}

function pickPreferredValue(values: Array<string | null | undefined>) {
  const filtered = values
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.sort((left, right) => right.length - left.length)[0];
}

export function buildInstitutionMatchKeys(name: string) {
  const profile = buildInstitutionProfile(name);
  if (!profile) {
    return [] as string[];
  }
  return buildMatchKeysFromProfile(profile);
}

function hasDistinctiveMatchKeyOverlap(
  leftKeys: Set<string>,
  rightKeys: string[],
) {
  const overlaps = rightKeys.filter((key) => leftKeys.has(key));
  if (overlaps.length === 0) {
    return false;
  }

  return overlaps.some((key) => {
    if (
      key.startsWith('norm:') ||
      key.startsWith('compact:') ||
      key.startsWith('core:') ||
      key.startsWith('corecompact:') ||
      key.startsWith('tail:') ||
      key.startsWith('tailcompact:')
    ) {
      return true;
    }

    if (
      key.startsWith('sig:') ||
      key.startsWith('abbr:') ||
      key.startsWith('abbrtoken:')
    ) {
      const [, suffix = ''] = key.split(':', 2);
      return suffix.length > 1 && !AMBIGUOUS_SIGNIFICANT_TOKENS.has(suffix);
    }

    return false;
  });
}

export function deriveInstitutionFacetKey(name: string) {
  const profile = buildInstitutionProfile(name);
  if (!profile) {
    return null;
  }

  const acronym = profile.acronymCandidates[0];
  if (acronym && acronym.length >= 3) {
    return `inst-${acronym}`;
  }

  if (profile.significantTokens.length >= 2) {
    const first = profile.significantTokens[0] ?? '';
    const last =
      profile.significantTokens[profile.significantTokens.length - 1] ?? '';
    if (first.length >= 2 && last.length >= 1) {
      const compressed = `${first.slice(0, 2)}${last[0]}${
        profile.hasUniversityToken ? 'u' : ''
      }`;
      if (compressed.length >= 4) {
        return `inst-${compressed}`;
      }
    }
  }

  return `inst-${buildNormalizedKeyFromProfile(profile)}`;
}

export function areInstitutionNamesEquivalent(left: string, right: string) {
  const leftProfile = buildInstitutionProfile(left);
  const rightProfile = buildInstitutionProfile(right);
  if (!leftProfile || !rightProfile) {
    return false;
  }

  const leftKeys = new Set(buildMatchKeysFromProfile(leftProfile));
  const rightKeys = buildMatchKeysFromProfile(rightProfile);
  if (hasDistinctiveMatchKeyOverlap(leftKeys, rightKeys)) {
    return true;
  }

  const smallerProfile =
    leftProfile.significantTokens.length <= rightProfile.significantTokens.length
      ? leftProfile
      : rightProfile;
  const largerProfile =
    smallerProfile === leftProfile ? rightProfile : leftProfile;

  if (smallerProfile.significantTokens.length >= 2) {
    const smallerCore = smallerProfile.significantTokens.join(' ');
    const largerCore = largerProfile.significantTokens.join(' ');
    if (smallerCore && largerCore.includes(smallerCore)) {
      return true;
    }
  }

  if (
    smallerProfile.compact.length >= 10 &&
    largerProfile.compact.includes(smallerProfile.compact)
  ) {
    return true;
  }

  const leftTokens = new Set(leftProfile.significantTokens);
  const rightTokens = new Set(rightProfile.significantTokens);
  const overlappingTokens: string[] = [];
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
      overlappingTokens.push(token);
    }
  }

  if (overlappingTokens.length > 0) {
    const distinctiveOverlap = overlappingTokens.filter(
      (token) => !AMBIGUOUS_SIGNIFICANT_TOKENS.has(token),
    );

    if (distinctiveOverlap.length === 0) {
      const leftAcronyms = new Set([
        ...leftProfile.acronymCandidates,
        ...leftProfile.uppercaseAcronyms,
      ]);
      const rightAcronyms = new Set([
        ...rightProfile.acronymCandidates,
        ...rightProfile.uppercaseAcronyms,
      ]);
      const hasAcronymOverlap = Array.from(leftAcronyms).some((token) =>
        rightAcronyms.has(token),
      );
      const hasMatchingLeadToken =
        !!leftProfile.significantTokens[0] &&
        leftProfile.significantTokens[0] === rightProfile.significantTokens[0];

      if (!hasAcronymOverlap && !hasMatchingLeadToken) {
        return false;
      }
    }
  }

  if (overlap < 2) {
    return false;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const minSize = Math.min(leftTokens.size, rightTokens.size);
  return overlap / union >= 0.5 || overlap / minSize >= 0.8;
}

export function pickPreferredInstitutionName(current?: string, incoming?: string) {
  if (!incoming?.trim()) {
    return current?.trim();
  }
  if (!current?.trim()) {
    return incoming.trim();
  }

  return scoreInstitutionNameCandidate(incoming) >
    scoreInstitutionNameCandidate(current)
    ? incoming.trim()
    : current.trim();
}

export function resolveInstitutionIdentity(
  inputs: InstitutionNameInput[],
): ResolvedInstitutionIdentity | null {
  const normalizedNames = new Map<
    string,
    {
      rawName: string;
      platforms: string[];
      city?: string;
      country?: string;
    }
  >();

  for (const input of inputs) {
    const name = input.name?.replace(/\s+/g, ' ').trim();
    if (!name) {
      continue;
    }

    const profile = buildInstitutionProfile(name);
    if (!profile) {
      continue;
    }

    const existing = normalizedNames.get(profile.normalized);
    if (!existing) {
      normalizedNames.set(profile.normalized, {
        rawName: profile.rawName,
        platforms: input.platform?.trim() ? [input.platform.trim()] : [],
        city: input.city?.trim() || undefined,
        country: input.country?.trim() || undefined,
      });
      continue;
    }

    existing.rawName =
      pickPreferredInstitutionName(existing.rawName, profile.rawName) ??
      existing.rawName;
    if (input.platform?.trim() && !existing.platforms.includes(input.platform.trim())) {
      existing.platforms.push(input.platform.trim());
    }
    existing.city = existing.city ?? (input.city?.trim() || undefined);
    existing.country = existing.country ?? (input.country?.trim() || undefined);
  }

  const entries = Array.from(normalizedNames.values());
  if (entries.length === 0) {
    return null;
  }

  const preferred = entries.reduce((best, current) =>
    scoreInstitutionNameCandidate(current.rawName) >=
    scoreInstitutionNameCandidate(best.rawName)
      ? current
      : best,
  );

  const preferredProfile = buildInstitutionProfile(preferred.rawName);
  if (!preferredProfile) {
    return null;
  }

  const canonicalName = preferred.rawName;
  const aliases = entries
    .map((entry) => entry.rawName)
    .filter((name) => name !== canonicalName)
    .sort((left, right) => left.localeCompare(right, 'tr-TR', { sensitivity: 'base' }));

  const platformAliases = entries.reduce((map, entry) => {
    for (const platform of entry.platforms) {
      const current = map.get(platform) ?? [];
      if (!current.includes(entry.rawName)) {
        current.push(entry.rawName);
      }
      map.set(platform, current);
    }
    return map;
  }, new Map<string, string[]>());

  const matchKeys = new Set<string>();
  for (const entry of entries) {
    for (const key of buildInstitutionMatchKeys(entry.rawName)) {
      matchKeys.add(key);
    }
  }

  return {
    canonicalName,
    normalizedKey: buildNormalizedKeyFromProfile(preferredProfile),
    aliases,
    matchKeys: Array.from(matchKeys),
    city: pickPreferredValue(entries.map((entry) => entry.city)),
    country: pickPreferredValue(entries.map((entry) => entry.country)),
    platformAliases: Array.from(platformAliases.entries()).map(([platform, names]) => ({
      platform,
      names: names.sort((left, right) =>
        left.localeCompare(right, 'tr-TR', { sensitivity: 'base' }),
      ),
    })),
  };
}
