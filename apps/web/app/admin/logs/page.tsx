import type { Metadata } from "next";
import AdminLogsPageClient from "./AdminLogsPageClient";
import { createPageMetadata, getRequestLocale } from "../../seo";
import { getAdminCopy } from "../adminCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin/logs",
    title: copy.logs.metaTitle,
    description: copy.logs.metaDescription,
  });
}

export default function AdminLogsPage() {
  return <AdminLogsPageClient />;
}
