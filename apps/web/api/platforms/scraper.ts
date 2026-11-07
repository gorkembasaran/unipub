import { apiRequest } from "../client";

export type UrlParam = {
  url: string;
};

export type IndexParam = {
  index?: number;
};

export type ScraperAuthorDetailParams = {
  url: string;
  index?: number;
};

export type AuthorProfileDetailParams = {
  authorProfileUrl: string;
};

export const scraperApi = {
  getTestStatic: () => apiRequest<unknown>("/scraper/test-static"),

  fetchByUrl: (params: UrlParam) =>
    apiRequest<unknown>("/scraper/fetch", { query: params }),

  parseStaticAuthors: () => apiRequest<unknown>("/scraper/parse-static"),

  parseAuthorsByUrl: (params: UrlParam) =>
    apiRequest<unknown>("/scraper/parse", { query: params }),

  getAuthorDetailStatic: (params: IndexParam = {}) =>
    apiRequest<unknown>("/scraper/author-detail-static", { query: params }),

  getAuthorDetail: (params: ScraperAuthorDetailParams) =>
    apiRequest<unknown>("/scraper/author-detail", { query: params }),

  getAuthorProfileDetail: (params: AuthorProfileDetailParams) =>
    apiRequest<unknown>("/scraper/author-profile-detail", { query: params }),

  parsePubmed: (params: UrlParam) =>
    apiRequest<unknown>("/scraper/pubmed-parse", { query: params }),
};
