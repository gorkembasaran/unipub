import { apiRequest } from "../client";

export type CatalogAuthor = {
  _id: string;
  fullName: string;
  affiliations?: string[];
  aliases?: string[];
  sourceProfiles?: Array<{
    platform: string;
    externalAuthorId: string;
    profileUrl?: string;
    score?: number;
  }>;
  university?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
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
  profileSummaryParts?: string[];
};

export type CatalogPublicationSourceRecord = {
  platform: string;
  sourceId?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
};

export type CatalogPublication = {
  _id: string;
  title: string;
  doi?: string;
  journal?: string;
  publishedAt?: string;
  publishedYear?: number;
  authors?: string[];
  authorsText?: string;
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
  sourceRecords?: CatalogPublicationSourceRecord[];
};

export type CatalogAuthorSummary = {
  _id: string;
  fullName: string;
  university: string | null;
  city: string | null;
  country: string | null;
  publicationCount: number;
};

export type CatalogStats = {
  totalPublications: number;
  totalAuthors: number;
  totalInstitutions: number;
  totalCountries: number;
  fetchedAt: string;
};

export type CatalogPublicationSyncProvider = {
  platform: string;
  status: "ok" | "error" | "unsupported" | "skipped";
  totalRaw: number;
  totalNormalized: number;
  reason?: string;
};

export type CatalogPublicationSyncResponse = {
  mode: "database" | "provider_sync";
  dbHit: boolean;
  force: boolean;
  authorId: string;
  authorName: string;
  totalHarvested: number;
  totalMerged: number;
  totalUpserted: number;
  catalogCount: number;
  providers: CatalogPublicationSyncProvider[];
  publications: CatalogPublication[];
  syncedAt: string;
};

export type CatalogPublicationDateFilter = "all" | "1" | "3" | "5";

function mapPublicationDateFilter(dateFilter: CatalogPublicationDateFilter) {
  return dateFilter === "all" ? undefined : Number(dateFilter);
}

export const catalogApi = {
  getStats: () =>
    apiRequest<CatalogStats>("/catalog/stats", {
      authToken: null,
    }),
  listAuthors: (limit = 50) =>
    apiRequest<CatalogAuthorSummary[]>("/catalog/authors", {
      query: { limit },
      authToken: null,
    }),
  getAuthor: (id: string) =>
    apiRequest<CatalogAuthor>(`/catalog/authors/${id}`, {
      authToken: null,
    }),
  listPublications: (
    authorId?: string,
    q?: string,
    dateFilter: CatalogPublicationDateFilter = "all",
  ) =>
    apiRequest<CatalogPublication[]>('/catalog/publications', {
      query: {
        authorId,
        q,
        years: mapPublicationDateFilter(dateFilter),
        yearWindow: mapPublicationDateFilter(dateFilter),
      },
      authToken: null,
    }),
  syncAuthorPublications: (
    authorId: string,
    limitPerSource = 25,
    force = false,
    dateFilter: CatalogPublicationDateFilter = "all",
    options: { authToken?: string | null } = {},
  ) =>
    apiRequest<CatalogPublicationSyncResponse>(
      `/catalog/authors/${authorId}/sync-publications`,
      {
        method: "POST",
        query: {
          limitPerSource,
          force,
          years: mapPublicationDateFilter(dateFilter),
          yearWindow: mapPublicationDateFilter(dateFilter),
        },
        authToken: options.authToken ?? null,
      },
    ),
};
