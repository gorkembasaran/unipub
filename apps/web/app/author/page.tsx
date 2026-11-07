import type { Metadata } from "next";
import { apiRequest } from "@/api/client";
import AuthorPageClient from "./AuthorPageClient";
import {
  buildAuthorPath,
  createPageMetadata,
  firstSearchParam,
  getRequestLocale,
  getTranslator,
} from "../seo";

type AuthorMetadataRecord = {
  fullName: string;
  affiliations?: string[];
  orcid?: string;
};

type AuthorPageProps = {
  searchParams?: {
    id?: string | string[];
    name?: string | string[];
  };
};

export async function generateMetadata({
  searchParams,
}: AuthorPageProps): Promise<Metadata> {
  const locale = getRequestLocale();
  const t = getTranslator(locale);
  const authorId = firstSearchParam(searchParams?.id).trim();
  const authorName = firstSearchParam(searchParams?.name).trim();

  if (!authorId) {
    if (authorName) {
      const metadataParams = new URLSearchParams({ name: authorName });

      return createPageMetadata({
        locale,
        path: `/author?${metadataParams.toString()}`,
        title: authorName,
        description: t("authors.link"),
      });
    }

    return createPageMetadata({
      locale,
      path: "/author",
      title: t("authors.link"),
      description: t("brand.subtitle"),
    });
  }

  try {
    const author = await apiRequest<AuthorMetadataRecord>(`/catalog/authors/${authorId}`);

    const title = author.fullName || t("authors.link");
    const detailParts = [
      author.affiliations?.filter(Boolean).slice(0, 2).join(" • ") ?? "",
      author.orcid ? `ORCID: ${author.orcid}` : "",
    ].filter(Boolean);

    return createPageMetadata({
      locale,
      path: buildAuthorPath(authorId),
      title,
      description: detailParts.join(". ") || t("brand.subtitle"),
    });
  } catch {
    return createPageMetadata({
      locale,
      path: buildAuthorPath(authorId),
      title: t("authors.link"),
      description: t("brand.subtitle"),
    });
  }
}

export default function AuthorPage() {
  return <AuthorPageClient />;
}
