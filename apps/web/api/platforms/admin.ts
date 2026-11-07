import { apiRequest } from "../client";

export type AdminAuthorAffiliation = {
  raw?: string;
  platform?: string;
  university?: string;
  department?: string;
  faculty?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
  institutionCanonicalName?: string;
  institutionCanonicalKey?: string;
  institutionId?: string;
  tokens?: string[];
};

export type AdminAuthorSourceProfile = {
  platform: string;
  platformKey?: string;
  platformLabel?: string;
  externalAuthorId: string;
  profileUrl?: string;
  score?: number;
  lastSyncedAt?: string;
};

export type AdminCatalogAuthor = {
  _id: string;
  fullName: string;
  normalizedName?: string;
  aliases?: string[];
  affiliations?: string[];
  parsedAffiliations?: AdminAuthorAffiliation[];
  searchKeywords?: string[];
  institutionAliases?: string[];
  sourceProfiles?: AdminAuthorSourceProfile[];
  university?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
  orcid?: string;
  profileSummaryParts?: string[];
  institution?: {
    id?: string;
    name?: string;
    canonicalKey?: string;
    aliases?: string[];
  };
  profile?: {
    institutionName?: string;
    title?: string;
    email?: string;
    emailDomain?: string;
    faculty?: string;
    country?: string;
    city?: string;
    department?: string;
  };
};

export type AdminCatalogPublicationSourceRecord = {
  platform: string;
  platformKey?: string;
  platformLabel?: string;
  sourceId?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
};

export type AdminCatalogPublication = {
  _id: string;
  title: string;
  doi?: string;
  journal?: string;
  publishedAt?: string;
  publishedYear?: number;
  authors?: string[];
  authorsText?: string;
  authorIds?: string[];
  abstract?: string;
  snippet?: string;
  keywords?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  pmid?: string;
  citationCount?: number;
  sourceRecords?: AdminCatalogPublicationSourceRecord[];
};

export type AdminAuthorSearchResponse = {
  query: string;
  total: number;
  items: AdminCatalogAuthor[];
};

export type AdminActivityLogFacet = {
  value: string;
  label: string;
  count: number;
};

export type AdminActivityLogPreview = {
  title: string;
  subtitle?: string;
  query?: string;
  resultCount?: number;
  path?: string;
  method?: string;
};

export type AdminActivityLogListItem = {
  id: string;
  requestId: string;
  action: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  actor?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  response: {
    statusCode: number;
    durationMs: number;
    success: boolean;
  };
  admin: {
    status: string;
    tags: string[];
    note?: string;
    pinned: boolean;
    updatedAt?: string;
    updatedBy?: Record<string, unknown>;
  };
  preview: AdminActivityLogPreview;
};

export type AdminActivityLogListResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: {
    category: string | null;
    action: string | null;
    status: string | null;
    success: boolean | null;
    actorType: string | null;
    entityType: string | null;
    q: string | null;
    from: string | null;
    to: string | null;
  };
  facets: {
    categories: AdminActivityLogFacet[];
    actions: AdminActivityLogFacet[];
    statuses: AdminActivityLogFacet[];
  };
  items: AdminActivityLogListItem[];
  fetchedAt: string;
};

export type AdminActivityLogDetail = {
  id: string;
  requestId?: string;
  action?: string;
  category?: string;
  actor?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  admin?: {
    status?: string;
    tags?: string[];
    note?: string;
    pinned?: boolean;
    updatedAt?: string;
    updatedBy?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
};

export type AdminActivityLogListFilters = {
  page?: number;
  pageSize?: number;
  category?: string;
  action?: string;
  status?: string;
  success?: boolean;
  actorType?: string;
  entityType?: string;
  q?: string;
  from?: string;
  to?: string;
};

export type AdminActivityLogUpdatePayload = {
  action?: string;
  category?: string;
  actor?: Record<string, unknown>;
  entity?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  admin?: {
    status?: string;
    tags?: string[];
    note?: string;
    pinned?: boolean;
  };
};

export type AdminAuthorUpdatePayload = {
  fullName?: string;
  aliases?: string[];
  affiliations?: string[];
  parsedAffiliations?: Array<Record<string, unknown>>;
  searchKeywords?: string[];
  institutionAliases?: string[];
  university?: string | null;
  city?: string | null;
  country?: string | null;
  emailDomain?: string | null;
  orcid?: string | null;
  sourceProfiles?: Array<{
    platform?: string;
    platformKey?: string;
    externalAuthorId?: string;
    profileUrl?: string;
    score?: number;
    lastSyncedAt?: string;
  }>;
};

export type AdminMergeAuthorsPayload = {
  primaryAuthorId: string;
  secondaryAuthorId: string;
};

export type AdminDetachSourceProfilesPayload = {
  sourceProfiles: Array<{
    platform?: string;
    platformKey?: string;
    externalAuthorId?: string;
    profileUrl?: string;
    score?: number;
    lastSyncedAt?: string;
  }>;
  targetAuthorId?: string;
  newAuthor?: AdminAuthorUpdatePayload;
  publicationIds?: string[];
  removeSelectedPublicationsFromSource?: boolean;
};

export type AdminRemoveSourceProfilesPayload = {
  sourceProfiles: Array<{
    platform?: string;
    platformKey?: string;
    externalAuthorId?: string;
    profileUrl?: string;
    score?: number;
    lastSyncedAt?: string;
  }>;
  publicationIds?: string[];
};

export type AdminReassignPublicationsPayload = {
  fromAuthorId: string;
  toAuthorId: string;
  publicationIds: string[];
  removeFromSource?: boolean;
};

export type AdminMergeAuthorsResponse = {
  primaryAuthorId: string;
  mergedFromAuthorId: string;
  movedPublicationCount: number;
  movedPublicationIds: string[];
  author: AdminCatalogAuthor;
};

export type AdminDetachSourceProfilesResponse = {
  sourceAuthor: AdminCatalogAuthor;
  targetAuthor: AdminCatalogAuthor;
  createdAuthor: boolean;
  detachedSourceProfiles: AdminAuthorSourceProfile[];
  movedPublicationCount: number;
  movedPublicationIds: string[];
};

export type AdminRemoveSourceProfilesResponse = {
  sourceAuthor: AdminCatalogAuthor;
  removedSourceProfiles: AdminAuthorSourceProfile[];
  updatedPublicationCount: number;
  updatedPublicationIds: string[];
};

export type AdminReassignPublicationsResponse = {
  fromAuthor: AdminCatalogAuthor;
  toAuthor: AdminCatalogAuthor;
  movedPublicationCount: number;
  movedPublicationIds: string[];
};

export const adminApi = {
  searchAuthors: (q: string, limit = 20) =>
    apiRequest<AdminAuthorSearchResponse>("/admin/authors", {
      query: { q, limit },
    }),
  getAuthor: (id: string) =>
    apiRequest<AdminCatalogAuthor>(`/admin/authors/${id}`),
  getAuthorPublications: (id: string, q?: string) =>
    apiRequest<AdminCatalogPublication[]>(`/admin/authors/${id}/publications`, {
      query: { q },
    }),
  updateAuthor: (id: string, payload: AdminAuthorUpdatePayload) =>
    apiRequest<AdminCatalogAuthor>(`/admin/authors/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  mergeAuthors: (payload: AdminMergeAuthorsPayload) =>
    apiRequest<AdminMergeAuthorsResponse>("/admin/authors/merge", {
      method: "POST",
      body: payload,
    }),
  detachSourceProfiles: (authorId: string, payload: AdminDetachSourceProfilesPayload) =>
    apiRequest<AdminDetachSourceProfilesResponse>(
      `/admin/authors/${authorId}/detach-source-profiles`,
      {
        method: "POST",
        body: payload,
      },
    ),
  removeSourceProfiles: (authorId: string, payload: AdminRemoveSourceProfilesPayload) =>
    apiRequest<AdminRemoveSourceProfilesResponse>(
      `/admin/authors/${authorId}/remove-source-profiles`,
      {
        method: "POST",
        body: payload,
      },
    ),
  reassignPublications: (payload: AdminReassignPublicationsPayload) =>
    apiRequest<AdminReassignPublicationsResponse>("/admin/publications/reassign", {
      method: "POST",
      body: payload,
    }),
  listActivityLogs: (filters: AdminActivityLogListFilters = {}) =>
    apiRequest<AdminActivityLogListResponse>("/admin/activity-logs", {
      query: filters,
    }),
  getActivityLog: (id: string) =>
    apiRequest<AdminActivityLogDetail>(`/admin/activity-logs/${id}`),
  updateActivityLog: (id: string, payload: AdminActivityLogUpdatePayload) =>
    apiRequest<AdminActivityLogDetail>(`/admin/activity-logs/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  deleteActivityLog: (id: string) =>
    apiRequest<{ deleted: boolean; id: string; deletedAt: string }>(
      `/admin/activity-logs/${id}`,
      {
        method: "DELETE",
      },
    ),
};
