import type { Metadata } from "next";
import AdminRefreshRequestsPageClient from "./AdminRefreshRequestsPageClient";
import { createPageMetadata, getRequestLocale } from "../../seo";
import { getAdminCopy } from "../adminCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin/refresh-requests",
    title: copy.refreshRequests.metaTitle,
    description: copy.refreshRequests.metaDescription,
  });
}

export default function AdminRefreshRequestsPage() {
  return <AdminRefreshRequestsPageClient />;
}
