import { FileDown, RefreshCcw } from "lucide-react";
import type { CatalogPublicationDateFilter } from "@/api/platforms/catalog";
import type {
  AuthorSyncProvider,
  PublicationDateFilterOption,
  PublicationYearGroup,
  SortOrder,
  TranslateFn,
} from "../authorPage.types";
import { isDemoMode } from "../../demoMode";
import { PLATFORM_LABELS } from "../authorPageUtils";
import { PublicationCard } from "./PublicationCard";

type AuthorPublicationsSectionProps = {
  availableProviders: AuthorSyncProvider[];
  currentDateFilterLabel: string;
  dateFilter: CatalogPublicationDateFilter;
  dateFilterOptions: PublicationDateFilterOption[];
  filteredPublicationsCount: number;
  feedback: {
    text: string;
    type: "error" | "success";
  } | null;
  isCatalogSearchProfile: boolean;
  isRequestingRefresh: boolean;
  locale: string;
  publicationsByYear: PublicationYearGroup[];
  refreshRequestAvailable: boolean;
  refreshRequestSent: boolean;
  sortOrder: SortOrder;
  syncLabel: string;
  t: TranslateFn;
  onDateFilterChange: (value: CatalogPublicationDateFilter) => void;
  onExport: () => void;
  onRequestRefresh: () => void;
  onSortToggle: () => void;
};

function getEditorButtonLabel(locale: string) {
  void locale;
  return "PDF Export";
}

export function AuthorPublicationsSection({
  availableProviders,
  currentDateFilterLabel,
  dateFilter,
  dateFilterOptions,
  feedback,
  filteredPublicationsCount,
  isCatalogSearchProfile,
  isRequestingRefresh,
  locale,
  publicationsByYear,
  refreshRequestAvailable,
  refreshRequestSent,
  sortOrder,
  syncLabel,
  t,
  onDateFilterChange,
  onExport,
  onRequestRefresh,
  onSortToggle,
}: AuthorPublicationsSectionProps) {
  const editorButtonLabel = getEditorButtonLabel(locale);
  const refreshButtonLabel = refreshRequestSent
    ? t("author.publications.refresh_request_sent_short")
    : isRequestingRefresh
      ? t("author.publications.refresh_request_loading")
      : t("author.publications.refresh_request");

  return (
    <section className="pubs-section">
      <div className="pubs-layout">
        <aside className="pubs-summary-card">
          <div className="pubs-summary-head">
            <div>
              <div className="pubs-summary-title">{t("author.publications.summary.title")}</div>
              {isCatalogSearchProfile ? (
                <div className="pubs-summary-subtitle">
                  {t("author.profile.catalog_note")}
                </div>
              ) : null}
            </div>
          </div>

          <div className="pubs-summary-stats">
            <div className="pubs-summary-stat">
              <span>{t("author.publications.summary.count")}</span>
              <strong>{filteredPublicationsCount}</strong>
            </div>
            <div className="pubs-summary-stat">
              <span>{t("author.publications.summary.last_sync")}</span>
              <strong>{syncLabel}</strong>
            </div>
            <div className="pubs-summary-stat">
              <span>{t("author.publications.summary.date_filter")}</span>
              <strong>{currentDateFilterLabel}</strong>
            </div>
          </div>

          {availableProviders.length > 0 ? (
            <div className="pubs-provider-block">
              <div className="pubs-provider-title">
                {t("author.publications.providers.title")}
              </div>
              <div className="pubs-provider-list">
                {availableProviders.map((provider) => (
                  <span
                    key={provider.platform}
                    className={`pubs-provider-chip is-${provider.status}`}
                  >
                    {PLATFORM_LABELS[provider.platform] ?? provider.platform}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <div className="pubs-main-card">
          <div className="pubs-title-row">
            <div>
              <h2 className="pubs-title">{t("author.publications.title")}</h2>
            </div>
            <div className="pubs-title-actions">
              <div className="pubs-date-filter" role="group" aria-label={t("author.publications.filter.aria")}>
                {dateFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      dateFilter === option.value
                        ? "pubs-date-filter-btn is-active"
                        : "pubs-date-filter-btn"
                    }
                    onClick={() => onDateFilterChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button type="button" className="pubs-sort-btn" onClick={onSortToggle}>
                <span>
                  {t("author.publications.sort", {
                    direction:
                      sortOrder === "desc"
                        ? t("author.publications.sort.new_to_old")
                        : t("author.publications.sort.old_to_new"),
                  })}
                </span>
              </button>
              {isDemoMode ? null : (
                <>
                  <button
                    type="button"
                    className="pubs-sync-btn"
                    onClick={onRequestRefresh}
                    disabled={isRequestingRefresh || !refreshRequestAvailable}
                    title={
                      refreshRequestAvailable
                        ? undefined
                        : t("author.publications.refresh_request_unavailable")
                    }
                  >
                    <RefreshCcw size={16} aria-hidden="true" />
                    <span>{refreshButtonLabel}</span>
                  </button>
                  <button type="button" className="pubs-export-btn" onClick={onExport}>
                    <FileDown size={16} aria-hidden="true" />
                    <span>{editorButtonLabel}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {feedback ? (
            <div
              className={
                feedback.type === "success"
                  ? "pubs-inline-feedback is-success"
                  : "pubs-inline-feedback is-error"
              }
            >
              {feedback.text}
            </div>
          ) : null}

          {filteredPublicationsCount === 0 ? (
            <p className="authors-empty">{t("author.publications.empty")}</p>
          ) : null}

          <div className="pub-year-groups">
            {publicationsByYear.map((group) => (
              <section
                key={group.year === null ? "unknown-year" : String(group.year)}
                className="pub-year-group"
              >
                <h3 className="pub-year-heading">
                  {group.year === null
                    ? t("author.publications.year.unknown")
                    : `${group.year}`}
                </h3>
                <ul className="pub-list">
                  {group.items.map((publication) => (
                    <PublicationCard
                      key={publication._id}
                      publication={publication}
                      locale={locale}
                      t={t}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
