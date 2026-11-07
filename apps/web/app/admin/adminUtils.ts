import type {
  AdminAuthorSourceProfile,
  AdminCatalogAuthor,
  AdminCatalogPublication,
} from "@/api";

export function getErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const normalized = error.message.replace(/^API error \d+:\s*/i, "").trim();
  return normalized || fallback;
}

export function splitLines(value: string) {
  return value
    .split(/\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinLines(values?: string[]) {
  return (values ?? []).filter(Boolean).join("\n");
}

export function safeJsonStringify(value: unknown, fallback = "[]") {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch {
    return fallback;
  }
}

export function dedupeAuthorResults(items: AdminCatalogAuthor[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item?._id || seen.has(item._id)) {
      return false;
    }
    seen.add(item._id);
    return true;
  });
}

export function getAuthorLocation(author?: AdminCatalogAuthor | null) {
  return [author?.city, author?.country].filter(Boolean).join(", ");
}

export function getPrimaryInstitution(author?: AdminCatalogAuthor | null, fallback = "") {
  return author?.profile?.institutionName || author?.university || fallback;
}

export function getSourceProfileKey(profile: AdminAuthorSourceProfile) {
  return `${profile.platformKey ?? profile.platform}:${profile.externalAuthorId}`;
}

export function getPublicationKey(publication: AdminCatalogPublication) {
  return publication._id;
}

export function getShortId(value?: string | null) {
  if (!value) return "";
  return value.slice(-6);
}

export function formatSourceProfileLabel(profile: AdminAuthorSourceProfile) {
  return profile.platformLabel ?? profile.platform;
}

export function formatProfileSyncDate(locale: string, value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(locale);
}

export function formatPublicationMeta(publication: AdminCatalogPublication) {
  const year =
    publication.publishedYear ||
    (publication.publishedAt ? new Date(publication.publishedAt).getUTCFullYear() : "");
  const parts = [
    publication.journal,
    year ? String(year) : "",
    publication.doi ? `DOI: ${publication.doi}` : "",
  ];
  return parts.filter(Boolean).join(" • ");
}

export function buildSourceProfilePreview(author: AdminCatalogAuthor, limit = 2) {
  const items = (author.sourceProfiles ?? []).slice(0, limit).map((profile) => {
    return `${formatSourceProfileLabel(profile)} · ${profile.externalAuthorId}`;
  });

  return {
    items,
    hiddenCount: Math.max((author.sourceProfiles?.length ?? 0) - items.length, 0),
  };
}
