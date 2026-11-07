import { apiRequest } from "../client";

export type TrdizinSearchByAuthorIdParams = {
  q: string;
  authorId: number;
};

export const trdizinApi = {
  getTestStatic: () => apiRequest<unknown>("/trdizin/test-static"),

  searchByAuthor: (q: string) =>
    apiRequest<unknown>("/trdizin/search", { query: { q } }),

  searchByAuthorId: (params: TrdizinSearchByAuthorIdParams) =>
    apiRequest<unknown>("/trdizin/search-by-author-id", { query: params }),
};
