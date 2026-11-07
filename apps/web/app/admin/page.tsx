import type { Metadata } from "next";
import AdminPageClient from "./AdminPageClient";
import { createPageMetadata, getRequestLocale } from "../seo";
import { getAdminCopy } from "./adminCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin",
    title: copy.authors.metaTitle,
    description: copy.authors.metaDescription,
  });
}

export default function AdminPage() {
  return <AdminPageClient />;
}
