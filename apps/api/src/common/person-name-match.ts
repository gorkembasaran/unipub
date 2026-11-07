import { normalizePersonName } from './normalize-person-name';

type PersonNameSignature = {
  normalized: string;
  lastName: string;
  firstTokens: string[];
  initials: string;
};

export function buildPersonNameSignature(
  rawValue?: string | null,
): PersonNameSignature | null {
  const raw = rawValue?.trim();
  if (!raw) {
    return null;
  }

  const normalized = normalizePersonName(raw);
  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const hasComma = raw.includes(',');
  const tailLooksLikeInitials =
    tokens.length > 1 &&
    tokens[0].length > 1 &&
    tokens.slice(1).every((token) => token.length <= 2);
  const headLooksLikeInitials =
    tokens.length > 1 &&
    tokens[tokens.length - 1].length > 1 &&
    tokens.slice(0, -1).every((token) => token.length <= 2);

  let lastName = '';
  let firstTokens: string[] = [];
  let initials = '';

  if (hasComma && tokens.length > 1) {
    lastName = tokens[0];
    firstTokens = tokens.slice(1);
    initials = firstTokens.map((token) => token[0]).join('');
  } else if (tailLooksLikeInitials) {
    lastName = tokens[0];
    initials = tokens.slice(1).join('');
  } else if (headLooksLikeInitials) {
    lastName = tokens[tokens.length - 1];
    initials = tokens.slice(0, -1).join('');
  } else if (tokens.length === 1) {
    lastName = tokens[0];
  } else {
    lastName = tokens[tokens.length - 1];
    firstTokens = tokens.slice(0, -1);
    initials = firstTokens.map((token) => token[0]).join('');
  }

  if (!lastName) {
    return null;
  }

  return {
    normalized,
    lastName,
    firstTokens,
    initials,
  };
}

export function arePersonNamesCompatible(
  targetName?: string | null,
  candidateName?: string | null,
  options?: {
    allowInitialSuffixMatch?: boolean;
  },
) {
  const target = buildPersonNameSignature(targetName);
  const candidate = buildPersonNameSignature(candidateName);

  if (!target || !candidate) {
    return false;
  }

  if (target.normalized === candidate.normalized) {
    return true;
  }

  if (target.lastName !== candidate.lastName) {
    return false;
  }

  const sharedFirstToken = candidate.firstTokens.some((token) =>
    target.firstTokens.includes(token),
  );
  if (sharedFirstToken) {
    return true;
  }

  const prefixFirstTokenMatch = candidate.firstTokens.some((token) =>
    target.firstTokens.some(
      (targetToken) =>
        targetToken === token ||
        targetToken.startsWith(token) ||
        token.startsWith(targetToken),
    ),
  );
  if (prefixFirstTokenMatch) {
    return true;
  }

  if (!target.initials || !candidate.initials) {
    return false;
  }

  if (target.initials === candidate.initials) {
    return true;
  }

  if (options?.allowInitialSuffixMatch) {
    if (
      candidate.initials.length < target.initials.length &&
      target.initials.endsWith(candidate.initials)
    ) {
      return true;
    }

    if (
      target.initials.length < candidate.initials.length &&
      candidate.initials.endsWith(target.initials)
    ) {
      return true;
    }
  }

  return false;
}
