import { apiRequest } from "../client";

export type SearchAuthorsParams = {
  q: string;
  hl?: string;
  num?: number;
  start?: number;
};

export type SearchNormalizedAuthorsParams = {
  q: string;
  hl?: string;
  start?: number;
  limit?: number;
};

export type AuthorDetailParams = {
  authorId: string;
  hl?: string;
  view_op?: string;
  sort?: string;
  citation_id?: string;
};

export type RankedAuthor = {
  author_id: string;
  name: string | null;
  affiliation: string | null;
  cited_by: number | null;
  score: number;
  matchedTokens: string[];
  normalizedName: string;
};

export type NormalizedAuthorSearchResponse = {
  query: string;
  normalizedQuery: string;
  totalRanked: number;
  authors: RankedAuthor[];
};

export const serpapiApi = {
  searchAuthors: (params: SearchAuthorsParams) =>
    apiRequest<unknown>("/serpapi/scholar/authors", { query: params }),

  searchAuthorsNormalized: (params: SearchNormalizedAuthorsParams) =>
    apiRequest<NormalizedAuthorSearchResponse>(
      "/serpapi/scholar/authors-normalized",
      { query: params },
    ),

  searchAuthorsStatic: () =>
    apiRequest<NormalizedAuthorSearchResponse>("/serpapi/scholar/authors-static"),

  getAuthorDetail: (params: AuthorDetailParams) =>
    apiRequest<unknown>("/serpapi/scholar/author-detail", { query: params }),
};
