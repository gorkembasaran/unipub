export function AuthorHeroSkeleton() {
  return (
    <section className="author-hero-card author-page-skeleton-card skeleton" aria-hidden="true">
      <div className="author-hero-header">
        <div className="author-avatar author-avatar-skeleton" />
        <div className="author-hero-copy">
          <div className="skeleton-line author-skeleton-title-line" />
          <div className="skeleton-line author-skeleton-subtitle-line-primary" />
          <div className="skeleton-line author-skeleton-subtitle-line-secondary" />
        </div>
      </div>
    </section>
  );
}

export function AuthorPublicationsSkeleton() {
  return (
    <section className="pubs-section author-page-skeleton" aria-hidden="true">
      <div className="pubs-layout">
        <aside className="pubs-summary-card author-page-skeleton-card skeleton">
          <div className="pubs-summary-head">
            <div className="author-page-skeleton-stack">
              <div className="skeleton-line author-skeleton-section-label" />
              <div className="skeleton-line author-skeleton-summary-label" />
            </div>
          </div>

          <div className="author-skeleton-stat-list">
            {[0, 1, 2].map((item) => (
              <div key={item} className="author-skeleton-stat-card">
                <div className="skeleton-line author-skeleton-stat-label" />
                <div className="skeleton-line author-skeleton-stat-value" />
              </div>
            ))}
          </div>

          <div className="author-skeleton-provider-block">
            <div className="skeleton-line author-skeleton-provider-title" />
            <div className="author-skeleton-provider-row">
              <span className="author-skeleton-provider-chip" aria-hidden="true">
                <span className="skeleton-line" />
              </span>
              <span className="author-skeleton-provider-chip" aria-hidden="true">
                <span className="skeleton-line" />
              </span>
            </div>
          </div>
        </aside>

        <div className="pubs-main-card author-page-skeleton-card skeleton">
          <div className="author-skeleton-main-head">
            <div className="author-page-skeleton-stack">
              <div className="skeleton-line author-skeleton-section-label" />
            </div>
            <div className="author-skeleton-action-row">
              <span className="author-skeleton-filter-pill">
                <span className="skeleton-line" />
              </span>
              <span className="author-skeleton-button">
                <span className="skeleton-line" />
              </span>
            </div>
          </div>

          <div className="pub-year-groups">
            <section className="pub-year-group">
              <div className="author-skeleton-year-chip">
                <div className="skeleton-line" />
              </div>
              <ul className="pub-list">
                {[0, 1].map((card) => (
                  <li key={card} className="pub-card pub-card-skeleton skeleton">
                    <div className="author-skeleton-chip-row">
                      <span className="author-skeleton-provider-chip" aria-hidden="true">
                        <span className="skeleton-line" />
                      </span>
                      <span className="author-skeleton-provider-chip" aria-hidden="true">
                        <span className="skeleton-line" />
                      </span>
                    </div>

                    <div className="skeleton-line author-skeleton-pub-title" />
                    <div className="skeleton-line author-skeleton-pub-subtitle" />

                    <div className="pub-details-grid">
                      {[0, 1, 2, 3].map((detail) => (
                        <div key={detail} className="pub-detail-item">
                          <div className="skeleton-line w25" />
                          <div className="skeleton-line w70" />
                        </div>
                      ))}
                    </div>

                    <div className="author-skeleton-summary">
                      <div className="skeleton-line w20" />
                      <div className="skeleton-line w90" />
                      <div className="skeleton-line w80" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AuthorPageSkeleton() {
  return (
    <>
      <AuthorHeroSkeleton />
      <AuthorPublicationsSkeleton />
    </>
  );
}
