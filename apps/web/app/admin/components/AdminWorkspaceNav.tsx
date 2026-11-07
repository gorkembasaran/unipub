"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookUser, Logs, RefreshCcw } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { getAdminCopy } from "../adminCopy";

export function AdminWorkspaceNav() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const copy = getAdminCopy(locale);

  const links = [
    {
      href: "/admin",
      label: copy.nav.authorsTitle,
      description: copy.nav.authorsSubtitle,
      icon: BookUser,
    },
    {
      href: "/admin/logs",
      label: copy.nav.logsTitle,
      description: copy.nav.logsSubtitle,
      icon: Logs,
    },
    {
      href: "/admin/refresh-requests",
      label: copy.nav.refreshRequestsTitle,
      description: copy.nav.refreshRequestsSubtitle,
      icon: RefreshCcw,
    },
  ] as const;

  return (
    <nav className="admin-workspace-nav" aria-label="Admin workspace navigation">
      {links.map((link) => {
        const isActive =
          link.href === "/admin"
            ? pathname.startsWith("/admin") && !pathname.startsWith("/admin/logs")
              && !pathname.startsWith("/admin/refresh-requests")
            : pathname === link.href;
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={isActive ? "admin-workspace-link is-active" : "admin-workspace-link"}
          >
            <span className="admin-workspace-link-icon">
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
