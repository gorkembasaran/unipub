import type {
  CatalogAuthor,
  CatalogPublication,
  CatalogPublicationDateFilter,
  CatalogPublicationSyncResponse,
} from "@/api/platforms/catalog";

export type Author = CatalogAuthor & {
  orcid?: string;
};

export type Publication = CatalogPublication;

export type PublicationSourceLink = {
  key: string;
  label: string;
  url?: string;
};

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export type PublicationDateFilterOption = {
  value: CatalogPublicationDateFilter;
  label: string;
};

export type PublicationYearGroup = {
  year: number | null;
  items: Publication[];
};

export type AuthorSyncProvider = CatalogPublicationSyncResponse["providers"][number];

export type SortOrder = "desc" | "asc";
