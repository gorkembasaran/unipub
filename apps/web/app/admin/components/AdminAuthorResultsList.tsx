"use client";

import type { ReactNode } from "react";
import type { AdminCatalogAuthor } from "@/api";
import {
  buildSourceProfilePreview,
  getAuthorLocation,
  getPrimaryInstitution,
  getShortId,
} from "../adminUtils";

type AdminAuthorResultsListProps = {
  authors: AdminCatalogAuthor[];
  selectedId?: string;
  emptyText: string;
  institutionFallback: string;
  className?: string;
  labels: {
    id: string;
    moreProfiles: string;
  };
  onSelect?: (author: AdminCatalogAuthor) => void;
  renderActions?: (author: AdminCatalogAuthor) => ReactNode;
};

export function AdminAuthorResultsList({
  authors,
  selectedId,
  emptyText,
  institutionFallback,
  className,
  labels,
  onSelect,
  renderActions,
}: AdminAuthorResultsListProps) {
  if (authors.length === 0) {
    return <div className="admin-empty-card">{emptyText}</div>;
  }

  return (
    <div className={className ? `admin-results-list ${className}` : "admin-results-list"}>
      {authors.map((author) => {
        const isActive = author._id === selectedId;
        const preview = buildSourceProfilePreview(author);
        return (
          <article
            key={author._id}
            className={isActive ? "admin-result-card admin-result-card-shell is-active" : "admin-result-card admin-result-card-shell"}
          >
            <button
              type="button"
              className="admin-result-card-main"
              onClick={() => onSelect?.(author)}
            >
              <div className="admin-result-title-row">
                <div className="admin-result-heading">
                  <strong>{author.fullName}</strong>
                  <div className="admin-result-meta admin-result-meta-primary">
                    {getPrimaryInstitution(author, institutionFallback)}
                  </div>
                  {getAuthorLocation(author) ? (
                    <div className="admin-result-meta">{getAuthorLocation(author)}</div>
                  ) : null}
                </div>
                <span className="admin-mini-pill admin-result-id-pill">
                  {labels.id} · {getShortId(author._id)}
                </span>
              </div>
              {preview.items.length > 0 ? (
                <div className="admin-result-preview">
                  {preview.items.map((item) => (
                    <span key={`${author._id}-${item}`}>{item}</span>
                  ))}
                  {preview.hiddenCount > 0 ? (
                    <span>{labels.moreProfiles.replace("{count}", String(preview.hiddenCount))}</span>
                  ) : null}
                </div>
              ) : null}
            </button>
            {renderActions ? <div className="admin-result-card-actions">{renderActions(author)}</div> : null}
          </article>
        );
      })}
    </div>
  );
}
