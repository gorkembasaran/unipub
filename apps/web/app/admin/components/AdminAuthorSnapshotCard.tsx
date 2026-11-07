"use client";

import type { ReactNode } from "react";
import type { AdminCatalogAuthor } from "@/api";
import { getAuthorLocation, getPrimaryInstitution, getShortId } from "../adminUtils";

type AdminAuthorSnapshotCardProps = {
  title: string;
  emptyLabel: string;
  author?: AdminCatalogAuthor | null;
  institutionFallback: string;
  locale?: string;
  publicationCount?: number | null;
  labels: {
    id: string;
    sourceProfiles: string;
    publications: string;
    aliases: string;
    selected?: string;
  };
  actions?: ReactNode;
  selected?: boolean;
  subtitle?: string;
};

export function AdminAuthorSnapshotCard({
  title,
  emptyLabel,
  author,
  institutionFallback,
  publicationCount = null,
  labels,
  actions,
  selected = false,
  subtitle,
}: AdminAuthorSnapshotCardProps) {
  const location = getAuthorLocation(author);
  const className = [
    "admin-author-snapshot",
    author ? "is-filled" : "",
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      <div className="admin-author-snapshot-head">
        <div className="admin-author-snapshot-head-copy">
          <p className="admin-eyebrow">{title}</p>
          <h3>{author?.fullName ?? emptyLabel}</h3>
          {subtitle ? <p className="admin-author-snapshot-subtitle">{subtitle}</p> : null}
        </div>
        {selected && labels.selected ? (
          <span className="admin-mini-pill is-success admin-author-snapshot-state">{labels.selected}</span>
        ) : null}
        {actions ? <div className="admin-author-snapshot-actions">{actions}</div> : null}
      </div>
      <div className="admin-author-snapshot-body">
        <div className="admin-author-snapshot-identity">
          <strong>{getPrimaryInstitution(author, institutionFallback)}</strong>
          {location ? <span>{location}</span> : null}
        </div>
        {author ? (
          <div className="admin-author-snapshot-metrics">
            <div className="admin-author-snapshot-metric">
              <span>{labels.id}</span>
              <strong>{getShortId(author._id)}</strong>
            </div>
            <div className="admin-author-snapshot-metric">
              <span>{labels.sourceProfiles}</span>
              <strong>{(author.sourceProfiles?.length ?? 0).toString()}</strong>
            </div>
            <div className="admin-author-snapshot-metric">
              <span>{labels.publications}</span>
              <strong>{(publicationCount ?? 0).toString()}</strong>
            </div>
            <div className="admin-author-snapshot-metric">
              <span>{labels.aliases}</span>
              <strong>{(author.aliases?.length ?? 0).toString()}</strong>
            </div>
          </div>
        ) : (
          <div className="admin-author-snapshot-empty">
            <span>{institutionFallback}</span>
          </div>
        )}
      </div>
    </section>
  );
}
