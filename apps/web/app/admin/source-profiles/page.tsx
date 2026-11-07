import type { Metadata } from "next";
import SourceProfilesAdminPageClient from "./SourceProfilesAdminPageClient";
import { createPageMetadata, getRequestLocale } from "../../seo";
import { getAdminWorkflowsCopy } from "../adminWorkflowsCopy";

export function generateMetadata(): Metadata {
  const locale = getRequestLocale();
  const copy = getAdminWorkflowsCopy(locale);

  return createPageMetadata({
    locale,
    path: "/admin/source-profiles",
    title: copy.sourceProfiles.metaTitle,
    description: copy.sourceProfiles.metaDescription,
  });
}

export default function AdminSourceProfilesPage() {
  return <SourceProfilesAdminPageClient />;
}
