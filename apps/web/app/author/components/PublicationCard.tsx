import { ArrowUpRight } from "lucide-react";
import type { Publication, PublicationSourceLink, TranslateFn } from "../authorPage.types";
import {
  formatAuthors,
  formatPublicationTitle,
  formatPublicationDate,
  getPublicationSourceLinks,
} from "../authorPageUtils";

type PublicationCardProps = {
  publication: Publication;
  locale: string;
  t: TranslateFn;
};

type PublicationDetailRow = {
  id: string;
  label: string;
  value: string;
};

export function PublicationCard({
  publication,
  locale,
  t,
}: PublicationCardProps) {
  const authors = formatAuthors(publication);
  const sourceLinks = getPublicationSourceLinks(publication);
  const sourceItems: PublicationSourceLink[] =
    sourceLinks.length > 0
      ? sourceLinks
      : [
          {
            key: "no-source",
            label: t("author.publications.sources.none"),
          },
        ];

  const detailRows: PublicationDetailRow[] = [
    {
      id: "journal",
      label: t("author.publications.details.journal"),
      value: publication.journal ?? t("common.not_found"),
    },
    {
      id: "published_at",
      label: t("author.publications.details.published_at"),
      value: formatPublicationDate(publication, locale, t),
    },
    {
      id: "doi",
      label: t("author.publications.details.doi"),
      value: publication.doi ?? t("common.not_found"),
    },
    {
      id: "authors",
      label: t("author.publications.details.authors"),
      value: authors ?? t("common.not_found"),
    },
    {
      id: "citations",
      label: t("author.publications.details.citation_count"),
      value:
        typeof publication.citationCount === "number"
          ? String(publication.citationCount)
          : t("common.not_found"),
    },
  ];

  return (
    <li className="pub-card">
      <h4 className="pub-title">{formatPublicationTitle(publication)}</h4>

      <div className="pub-details-grid">
        {detailRows.map((item) => (
          <div key={`${publication._id}-${item.id}`} className="pub-detail-item">
            <div className="pub-detail-label">{item.label}</div>
            <div className="pub-detail-value">{item.value}</div>
          </div>
        ))}

        <div className="pub-detail-item">
          <div className="pub-detail-label">
            {t("author.publications.details.source_platforms")}
          </div>
          <div className="pub-detail-value">
            <div className="pub-platform-links">
              {sourceItems.map((source) => {
                if (!source.url) {
                  return (
                    <span key={`${publication._id}-${source.key}`} className="pub-platform-chip">
                      {source.label}
                    </span>
                  );
                }

                return (
                  <a
                    key={`${publication._id}-${source.key}`}
                    className="pub-platform-chip is-link"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`${source.label} linki`}
                  >
                    <span>{source.label}</span>
                    <ArrowUpRight
                      size={13}
                      className="pub-platform-chip-icon"
                      aria-hidden="true"
                    />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
