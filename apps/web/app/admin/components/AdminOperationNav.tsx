"use client";

import Link from "next/link";
import { ArrowRightLeft, GitMerge, Link2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "../../i18n/I18nProvider";
import { getAdminWorkflowsCopy } from "../adminWorkflowsCopy";

export function AdminOperationNav(props: { authorId?: string; query?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const copy = getAdminWorkflowsCopy(locale);
  const authorId =
    props.authorId?.trim() ||
    searchParams.get("authorId")?.trim() ||
    "";
  const query = props.query?.trim() || searchParams.get("q")?.trim() || "";

  const links = [
    { ...copy.nav.merge, icon: GitMerge },
    { ...copy.nav.sourceProfiles, icon: Link2 },
    { ...copy.nav.publications, icon: ArrowRightLeft },
  ] as const;

  return (
    <nav className="admin-operation-nav" aria-label="Admin workflow navigation">
      {links.map((link) => {
        const Icon = link.icon;
        const isActive = pathname === link.href;
        const params = new URLSearchParams();
        if (authorId) {
          params.set("authorId", authorId);
        }
        if (query) {
          params.set("q", query);
        }
        const href = params.size > 0 ? `${link.href}?${params.toString()}` : link.href;
        return (
          <Link
            key={link.href}
            href={href}
            className={isActive ? "admin-operation-link is-active" : "admin-operation-link"}
          >
            <span className="admin-operation-link-icon">
              <Icon size={16} />
            </span>
            <span className="admin-workspace-link-copy">
              <strong>{link.label}</strong>
              <small>{link.description}</small>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
