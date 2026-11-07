import { ScraperService } from './scraper.service';

describe('ScraperService Scopus parsing', () => {
  function createService() {
    return new ScraperService();
  }

  const renderedPreviewHtml = `
    <!DOCTYPE html>
    <html lang="en_US" class="hydrated">
      <head>
        <title>Yuce, Yilmaz - Author details - Scopus Preview</title>
      </head>
      <body>
        <micro-ui component-id="scopus-author-profile-page-control-microui" authorid="18635626400">
          <scopus-author-profile-page-control-microui authorid="18635626400">
            <h1 data-testid="author-profile-name">Yuce, Yilmaz</h1>
            <span data-testid="authorInstitution">
              <a><span>Alanya Alaaddin Keykubat University</span></a>
              <span>, Alanya, Turkey</span>
            </span>
            <a href="https://www.scopus.com/redirect.uri?url=https://orcid.org/0000-0003-4023-0401&amp;authorId=18635626400">
              ORCID
            </a>
            <div data-testid="metrics-section-citations-count">
              <span data-testid="unclickable-count">215</span>
              <p>Citations by <strong>156</strong> documents</p>
            </div>
            <div data-testid="metrics-section-document-count">
              <span data-testid="unclickable-count">25</span>
              <p>Documents</p>
            </div>
            <div data-testid="metrics-section-h-index">
              <span data-testid="unclickable-count">9</span>
              <p><em>h</em>-index</p>
            </div>
            <button id="documents"><span>Documents (25)</span></button>
            <button id="cited-by"><span>Cited by (156)</span></button>
            <button id="preprints"><span>Preprints (0)</span></button>
            <button id="co-authors"><span>Co-authors (27)</span></button>
            <button id="grants"><span>Awarded grants (0)</span></button>
            <div id="documents-panel">
              <span>2 of 25 documents</span>
              <span>Limited access</span>
              <span>Results list, nothing to display.</span>
            </div>
          </scopus-author-profile-page-control-microui>
        </micro-ui>
      </body>
    </html>
  `;

  const renderedDocumentListHtml = `
    <!DOCTYPE html>
    <html lang="en_US" class="hydrated">
      <head>
        <title>Scopus - Yuce, Yilmaz - Author details - Scopus</title>
      </head>
      <body>
        <micro-ui component-id="scopus-author-profile-page-control-microui" authorid="18635626400">
          <scopus-author-profile-page-control-microui authorid="18635626400">
            <h1 data-testid="author-profile-name">Yuce, Yilmaz</h1>
            <div data-testid="metrics-section-document-count">
              <span data-testid="unclickable-count">2</span>
              <p>Documents</p>
            </div>
            <button id="documents"><span>Documents (2)</span></button>
            <button id="cited-by"><span>Cited by (9)</span></button>
            <button id="preprints"><span>Preprints (0)</span></button>
            <button id="co-authors"><span>Co-authors (3)</span></button>
            <button id="grants"><span>Awarded grants (0)</span></button>
            <div id="documents-panel">
              <span>2 of 2 documents</span>
              <article class="result-item">
                <a href="/record/display.uri?eid=2-s2.0-85123456789">
                  Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application
                </a>
                <span class="authors">Yuce, Y.; Yildiz, H.</span>
                <span class="source-title">Stud Health Technol Inform</span>
                <span class="document-type">Conference Paper</span>
                <span class="year">2023</span>
                <span class="cited-by">Cited by 7</span>
                <span class="doi">10.3233/SHTI230793</span>
              </article>
              <article class="result-item">
                <a href="/record/display.uri?eid=2-s2.0-85111111111">
                  Mobile Health Usability Criteria for Personal Health Records
                </a>
                <span class="authors">Yuce, Y.; Zayim, N.</span>
                <span class="source-title">Health Informatics Journal</span>
                <span class="document-type">Article</span>
                <span class="year">2024</span>
                <span class="cited-by">Cited by 2</span>
              </article>
            </div>
          </scopus-author-profile-page-control-microui>
        </micro-ui>
      </body>
    </html>
  `;

  it('parses rendered Scopus preview details into structured author metadata', () => {
    const service = createService();

    const parsed = (service as any).parseAuthorDetailHtml(
      renderedPreviewHtml,
      'https://www.scopus.com/authid/detail.uri?authorId=18635626400',
    );

    expect(parsed).toMatchObject({
      pageType: 'author-detail',
      renderMode: 'rendered',
      previewMode: true,
      authorId: '18635626400',
      authorName: 'Yuce, Yilmaz',
      institution: 'Alanya Alaaddin Keykubat University',
      city: 'Alanya',
      country: 'Turkey',
      orcid: '0000-0003-4023-0401',
      metrics: {
        documents: 25,
        citations: 215,
        hIndex: 9,
      },
      tabCounts: {
        documents: 25,
        citedBy: 156,
        preprints: 0,
        coAuthors: 27,
        grants: 0,
      },
      publicationSummary: {
        totalDocuments: 25,
        renderedDocuments: 2,
        visibleDocuments: 0,
        limitedAccess: true,
        previewMode: true,
        hasVisibleList: false,
        documentPanelMessage: 'Results list, nothing to display.',
      },
    });
    expect(parsed.publications).toEqual([]);
  });

  it('extracts Scopus document cards when rendered detail contains publication links', () => {
    const service = createService();

    const parsed = (service as any).parseAuthorDetailHtml(
      renderedDocumentListHtml,
      'https://www.scopus.com/authid/detail.uri?authorId=18635626400',
    );

    expect(parsed.publicationSummary).toMatchObject({
      totalDocuments: 2,
      renderedDocuments: 2,
      visibleDocuments: 2,
      limitedAccess: false,
      previewMode: false,
      hasVisibleList: true,
    });
    expect(parsed.publications).toEqual([
      {
        title:
          'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application',
        articleUrl:
          'https://www.scopus.com/record/display.uri?eid=2-s2.0-85123456789',
        sourceId: '2-s2.0-85123456789',
        doi: '10.3233/shti230793',
        journal: 'Stud Health Technol Inform',
        authors: ['Yuce, Y.', 'Yildiz, H.'],
        authorsText: 'Yuce, Y.; Yildiz, H.',
        publishedYear: 2023,
        citationCount: 7,
        documentType: 'Conference Paper',
      },
      {
        title: 'Mobile Health Usability Criteria for Personal Health Records',
        articleUrl:
          'https://www.scopus.com/record/display.uri?eid=2-s2.0-85111111111',
        sourceId: '2-s2.0-85111111111',
        doi: undefined,
        journal: 'Health Informatics Journal',
        authors: ['Yuce, Y.', 'Zayim, N.'],
        authorsText: 'Yuce, Y.; Zayim, N.',
        publishedYear: 2024,
        citationCount: 2,
        documentType: 'Article',
      },
    ]);
  });
});
