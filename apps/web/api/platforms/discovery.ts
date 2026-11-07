import { apiRequest } from "../client";
import type {
  CatalogAuthor,
  CatalogPublication,
  CatalogPublicationDateFilter,
  CatalogPublicationSyncResponse,
} from "./catalog";
import { sanitizeDiscoveryAuthorsResponse } from "./authorIdentity";

export type DiscoveryAuthorItem = {
  dbAuthorId?: string;
  displayName: string;
  normalizedName?: string;
  aliases?: string[];
  affiliationRaw?: string[];
  parsedAffiliations?: Array<{
    raw?: string;
    platform?: string;
    personTitle?: string;
    role?: string;
    department?: string;
    faculty?: string;
    university?: string;
    city?: string;
    country?: string;
    emailDomain?: string;
    tokens?: string[];
  }>;
  searchKeywords?: string[];
  sourceProfiles?: Array<{
    platform: string;
    externalAuthorId: string;
    profileUrl?: string;
    score?: number;
  }>;
  score?: number;
  dbMatchScore?: number;
  university?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
  recentWork?: string;
  publications?: number;
  citations?: number;
  hIndex?: number;
  splitClusterKey?: string;
  splitSourceKey?: string;
};

export type DiscoveryAuthorsResponse = {
  query: string;
  total: number;
  filters?: {
    country?: string;
    city?: string;
    institution?: string;
  };
  source?: string;
  providers?: {
    serpapi?: number;
    trdizin?: number;
    scraper?: number;
    scraperScopus?: number;
    scraperPubmed?: number;
  };
  items: DiscoveryAuthorItem[];
  fetchedAt: string;
};

export type DiscoveryAuthorSearchFilters = {
  country?: string;
  city?: string;
  school?: string;
  institution?: string;
  university?: string;
};

export type DiscoveryAuthorFilterOption = {
  value: string;
  label: string;
  count: number;
  countryValue?: string;
  cityValue?: string;
};

export type DiscoveryAuthorFiltersResponse = {
  selected: {
    country: string | null;
    city: string | null;
    school: string | null;
  };
  countries: DiscoveryAuthorFilterOption[];
  cities: DiscoveryAuthorFilterOption[];
  schools: DiscoveryAuthorFilterOption[];
  fetchedAt: string;
};

export type DiscoveryAuthorRefreshRequestPayload = {
  authorName?: string;
  context?: string;
  profilePath?: string;
};

export type DiscoveryAuthorRefreshRequestResponse = {
  requested: boolean;
  requestId?: string;
  status?: string;
  message?: string;
};

function mapPublicationDateFilter(dateFilter: CatalogPublicationDateFilter) {
  return dateFilter === "all" ? undefined : Number(dateFilter);
}

export const discoveryApi = {
  searchAuthors: async (
    q: string,
    limit = 5,
    filters: DiscoveryAuthorSearchFilters = {},
  ) => {
    const response = await apiRequest<DiscoveryAuthorsResponse>("/discovery/authors", {
      query: { q, limit, ...filters },
      authToken: null,
    });

    return sanitizeDiscoveryAuthorsResponse(response);
  },

  getAuthorFilters: (filters: DiscoveryAuthorSearchFilters = {}) =>
    apiRequest<DiscoveryAuthorFiltersResponse>("/discovery/authors/filters", {
      query: filters,
      authToken: null,
    }),

  getAuthor: (id: string) =>
    apiRequest<CatalogAuthor>(`/discovery/authors/${id}`, {
      authToken: null,
    }),

  listPublications: (
    authorId?: string,
    q?: string,
    dateFilter: CatalogPublicationDateFilter = "all",
  ) =>
    apiRequest<CatalogPublication[]>("/discovery/publications", {
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
      `/discovery/authors/${authorId}/publications/sync`,
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

  requestAuthorRefresh: (
    authorId: string,
    payload: DiscoveryAuthorRefreshRequestPayload = {},
  ) =>
    apiRequest<DiscoveryAuthorRefreshRequestResponse>(
      `/discovery/authors/${authorId}/refresh-request`,
      {
        method: "POST",
        body: payload,
      },
    ),
};
