import type { Metadata } from "next";
import MergeAdminPageClient from "./MergeAdminPageClient";
import { createPageMetadata, getRequestLocale } from "../../seo";
import { getAdminWorkflowsCopy } from "../adminWorkflowsCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminWorkflowsCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin/merge",
    title: copy.merge.metaTitle,
    description: copy.merge.metaDescription,
  });
}

export default function AdminMergePage() {
  return <MergeAdminPageClient />;
}
