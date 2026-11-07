import type { Metadata } from "next";
import PublicationsAdminPageClient from "./PublicationsAdminPageClient";
import { createPageMetadata, getRequestLocale } from "../../seo";
import { getAdminWorkflowsCopy } from "../adminWorkflowsCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminWorkflowsCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin/publications",
    title: copy.publications.metaTitle,
    description: copy.publications.metaDescription,
  });
}

export default function AdminPublicationsPage() {
  return <PublicationsAdminPageClient />;
}
