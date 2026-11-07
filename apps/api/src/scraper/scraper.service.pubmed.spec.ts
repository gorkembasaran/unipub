import { ScraperService } from './scraper.service';

const PUBMED_SEARCH_HTML = `
<html>
  <head>
    <title>Yılmaz Kemal Yüce - Search Results - PubMed</title>
  </head>
  <body>
    <div class="top-pagination">
      <div class="page-number-wrapper">
        <form class="page-number-form">
          <input class="page-number" value="1" max="2" />
        </form>
        <label class="of-total-pages">of 2</label>
      </div>
      <button class="button-wrapper last-page-btn" data-max-page="2"></button>
    </div>
    <article class="full-docsum">
      <a class="docsum-title" href="/37869854/">
        Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application.
      </a>
      <span class="docsum-journal-citation">
        Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.
      </span>
      <span class="docsum-authors">Zayim N, Yildiz H, Yüce YK.</span>
      <div class="full-view-snippet">A short snippet for the first article.</div>
    </article>

    <article class="full-docsum">
      <a
        class="docsum-title"
        href="https://pubmed.ncbi.nlm.nih.gov/37497042/"
      >
        Statistically significant features improve binary and multiple Motor Imagery task predictions from EEGs.
      </a>
      <span class="docsum-journal-citation">
        Front Hum Neurosci. 2023 Jul 11;17:1223307. doi: 10.3389/fnhum.2023.1223307. eCollection 2023.
      </span>
      <span class="docsum-authors">Degirmenci M, Yuce YK , Perc M, Isler Y.</span>
    </article>
  </body>
</html>
`;

const PUBMED_DETAIL_HTML = `
<html>
  <head>
    <link rel="canonical" href="https://pubmed.ncbi.nlm.nih.gov/37964458/" />
    <meta name="citation_pmid" content="37964458">
    <meta name="citation_date" content="2023 Oct">
    <meta name="citation_journal_title" content="Healthcare informatics research">
    <meta name="citation_doi" content="10.4258/hir.2023.29.4.367">
    <meta name="citation_volume" content="29">
    <meta name="citation_issue" content="4">
  </head>
  <body>
    <div class="authors-list">
      <span class="authors-list-item ">
        <a class="full-name" data-ga-label="Neşe Zayim">Neşe Zayim</a>
        <sup class="affiliation-links">
          <a class="affiliation-link" title="Department of Biostatistics and Medical Informatics, Faculty of Medicine, Akdeniz University, Antalya, Türkiye.">1</a>
        </sup>
        <span class="comma">,&nbsp;</span>
      </span>
      <span class="authors-list-item ">
        <a class="full-name" data-ga-label="Yilmaz Kemal Yüce">Yilmaz Kemal Yüce</a>
        <sup class="affiliation-links">
          <a class="affiliation-link" title="Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.">2</a>
        </sup>
      </span>
    </div>
    <div class="abstract" id="abstract">
      <div class="abstract-content selected" id="eng-abstract">
        <p><strong class="sub-title">Objectives:</strong> Mobile health applications can lead to cognitive overload.</p>
      </div>
    </div>
  </body>
</html>
`;

describe('ScraperService PubMed', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SCRAPERAPI_KEY;
  const originalPubmedSearchMaxPages = process.env.PUBMED_SEARCH_MAX_PAGES;
  const originalPubmedDetailMaxFetches =
    process.env.PUBMED_DETAIL_MAX_FETCHES;
  const originalPubmedDetailMinScore =
    process.env.PUBMED_DETAIL_MIN_SCORE;

  beforeEach(() => {
    process.env.SCRAPERAPI_KEY = 'test-scraper-key';
    process.env.PUBMED_SEARCH_MAX_PAGES = '2';
    process.env.PUBMED_DETAIL_MAX_FETCHES = '0';
    process.env.PUBMED_DETAIL_MIN_SCORE = '12';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SCRAPERAPI_KEY = originalApiKey;
    process.env.PUBMED_SEARCH_MAX_PAGES = originalPubmedSearchMaxPages;
    process.env.PUBMED_DETAIL_MAX_FETCHES = originalPubmedDetailMaxFetches;
    process.env.PUBMED_DETAIL_MIN_SCORE = originalPubmedDetailMinScore;
    jest.restoreAllMocks();
  });

  it('parses PubMed search HTML into article records', async () => {
    const service = new ScraperService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => PUBMED_SEARCH_HTML,
      headers: {
        get: (header: string) =>
          header.toLowerCase() === 'content-type'
            ? 'text/html; charset=utf-8'
            : null,
      },
    } as Response) as typeof fetch;

    const result = await service.parsePubmedSearchResults(
      'https://pubmed.ncbi.nlm.nih.gov/?term=Y%C4%B1lmaz%20Kemal%20Y%C3%BCce',
    );

    expect(result.status).toBe(200);
    expect(result.pageTitle).toBe('Yılmaz Kemal Yüce - Search Results - PubMed');
    expect(result.articleCount).toBe(2);
    expect(result.pagination).toEqual({
      currentPage: 1,
      totalPages: 2,
      hasNextPage: true,
    });
    expect(result.articles).toEqual([
      {
        pmid: '37869854',
        title:
          'Subjective Cognitive Load Evaluation of a Mobile Personal Health Record Application.',
        articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
        journalCitation:
          'Stud Health Technol Inform. 2023 Oct 20;309:262-266. doi: 10.3233/SHTI230793.',
        authors: 'Zayim N, Yildiz H, Yüce YK.',
        snippet: 'A short snippet for the first article.',
      },
      {
        pmid: '37497042',
        title:
          'Statistically significant features improve binary and multiple Motor Imagery task predictions from EEGs.',
        articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37497042/',
        journalCitation:
          'Front Hum Neurosci. 2023 Jul 11;17:1223307. doi: 10.3389/fnhum.2023.1223307. eCollection 2023.',
        authors: 'Degirmenci M, Yuce YK , Perc M, Isler Y.',
        snippet: null,
      },
    ]);
  });

  it('builds PubMed search terms for a multi-initial author without broad single-initial fallback', () => {
    const service = new ScraperService();

    const terms = (service as any).buildPubmedAuthorTerms('Yılmaz Kemal Yüce', {
      firstName: 'Yılmaz Kemal',
      lastName: 'Yüce',
    });

    expect(terms).toEqual([
      'Yılmaz Kemal Yüce',
      'Yüce Yılmaz Kemal',
      'yuce YK[Author]',
    ]);
    expect(terms).not.toContain('yuce Y[Author]');
  });

  it('scores PubMed author strings strictly for multi-initial queries', () => {
    const service = new ScraperService();
    const parts = {
      firstName: 'Yılmaz Kemal',
      lastName: 'Yüce',
    };

    expect(
      (service as any).scorePubmedArticleAuthorMatch(
        'Yılmaz Kemal Yüce',
        parts,
        'Degirmenci M, Yuce YK , Perc M, Isler Y.',
      ),
    ).toBeGreaterThan(0);
    expect(
      (service as any).scorePubmedArticleAuthorMatch(
        'Yılmaz Kemal Yüce',
        parts,
        'Degirmenci M, Yuce Y , Perc M, Isler Y.',
      ),
    ).toBe(0);
    expect(
      (service as any).scorePubmedArticleAuthorMatch(
        'Yılmaz Kemal Yüce',
        parts,
        'Degirmenci M, Demir YK , Perc M, Isler Y.',
      ),
    ).toBe(0);
  });

  it('deduplicates matched PubMed articles across query variants and aggregates matchedBy terms', async () => {
    const service = new ScraperService();
    const parseSpy = jest.spyOn(
      service as any,
      'parsePubmedSearchResults',
    ) as jest.MockedFunction<(url: string) => Promise<unknown>>;

    parseSpy
      .mockResolvedValueOnce({
        pageTitle: 'Run 1',
        articleCount: 3,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '37869854',
            title: 'Article A',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yüce YK.',
            snippet: '',
          },
          {
            pmid: '37497042',
            title: 'Article B',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37497042/',
            journalCitation: 'Front Hum Neurosci. 2023 Jul 11;17:1223307.',
            authors: 'Degirmenci M, Yuce YK , Perc M.',
            snippet: '',
          },
          {
            pmid: 'ignore-me',
            title: 'False positive',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/ignore-me/',
            journalCitation: null,
            authors: 'Someone Else, Yuce Y.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 2',
        articleCount: 2,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '37869854',
            title: 'Article A',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yüce YK.',
            snippet: '',
          },
          {
            pmid: '37964458',
            title: 'Article C',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37964458/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):367-376.',
            authors: 'Zayim N, Yüce YK.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 3',
        articleCount: 2,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '37869854',
            title: 'Article A',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yüce YK.',
            snippet: '',
          },
          {
            pmid: '38505099',
            title: 'Article D',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/38505099/',
            journalCitation: 'Front Hum Neurosci. 2024 Mar 5;18:1362135.',
            authors: 'Degirmenci M, Yuce YK , Perc M.',
            snippet: '',
          },
        ],
      } as never);

    const result = await service.searchPubmedAuthor('Yılmaz Kemal Yüce', 10);

    expect(parseSpy).toHaveBeenCalledTimes(3);
    expect(result.queryCandidates).toEqual([
      'Yılmaz Kemal Yüce',
      'Yüce Yılmaz Kemal',
      'yuce YK[Author]',
    ]);
    expect(result.totalMatched).toBe(4);
    expect(result.matchedArticles).toEqual([
      expect.objectContaining({
        pmid: '37869854',
        matchedBy: [
          'Yılmaz Kemal Yüce',
          'Yüce Yılmaz Kemal',
          'yuce YK[Author]',
        ],
      }),
      expect.objectContaining({
        pmid: '37497042',
        matchedBy: ['Yılmaz Kemal Yüce'],
      }),
      expect.objectContaining({
        pmid: '37964458',
        matchedBy: ['Yüce Yılmaz Kemal'],
      }),
      expect.objectContaining({
        pmid: '38505099',
        matchedBy: ['yuce YK[Author]'],
      }),
    ]);
    expect(result.matchedArticles?.some((item) => item.pmid === 'ignore-me')).toBe(
      false,
    );
  });

  it('fetches additional PubMed result pages when pagination indicates more pages', async () => {
    const service = new ScraperService();
    const parseSpy = jest.spyOn(
      service as any,
      'parsePubmedSearchResults',
    ) as jest.MockedFunction<(url: string) => Promise<unknown>>;

    parseSpy
      .mockResolvedValueOnce({
        pageTitle: 'Run 1 Page 1',
        articleCount: 1,
        pagination: {
          currentPage: 1,
          totalPages: 2,
          hasNextPage: true,
        },
        articles: [
          {
            pmid: 'page-1-hit',
            title: 'Page 1 Hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/page-1-hit/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):367-376.',
            authors: 'Yuce YK.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 1 Page 2',
        articleCount: 1,
        pagination: {
          currentPage: 2,
          totalPages: 2,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: 'page-2-hit',
            title: 'Page 2 Hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/page-2-hit/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):377-388.',
            authors: 'Yuce YK.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 2',
        articleCount: 0,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 3',
        articleCount: 0,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [],
      } as never);

    const result = await service.searchPubmedAuthor('Yılmaz Kemal Yüce', 10);

    expect(parseSpy).toHaveBeenCalledTimes(4);
    expect(result.matchedArticles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pmid: 'page-1-hit' }),
        expect.objectContaining({ pmid: 'page-2-hit' }),
      ]),
    );
  });

  it('continues beyond the historical two-page ceiling when later PubMed pages exist', async () => {
    const service = new ScraperService();
    const parseSpy = jest.spyOn(
      service as any,
      'parsePubmedSearchResults',
    ) as jest.MockedFunction<(url: string) => Promise<unknown>>;

    parseSpy
      .mockResolvedValueOnce({
        pageTitle: 'Single Run Page 1',
        articleCount: 1,
        pagination: {
          currentPage: 1,
          totalPages: 3,
          hasNextPage: true,
        },
        articles: [
          {
            pmid: 'page-1-hit',
            title: 'Page 1 Hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/page-1-hit/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):367-376.',
            authors: 'Yuce YK.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Single Run Page 2',
        articleCount: 1,
        pagination: {
          currentPage: 2,
          totalPages: 3,
          hasNextPage: true,
        },
        articles: [
          {
            pmid: 'page-2-hit',
            title: 'Page 2 Hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/page-2-hit/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):377-388.',
            authors: 'Yuce YK.',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Single Run Page 3',
        articleCount: 1,
        pagination: {
          currentPage: 3,
          totalPages: 3,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: 'page-3-hit',
            title: 'Page 3 Hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/page-3-hit/',
            journalCitation: 'Healthc Inform Res. 2023 Oct;29(4):389-400.',
            authors: 'Yuce YK.',
            snippet: '',
          },
        ],
      } as never);

    const result = await service.searchPubmedAuthor('Yuce', 50);

    expect(parseSpy).toHaveBeenCalledTimes(3);
    expect(result.matchedArticles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pmid: 'page-1-hit' }),
        expect.objectContaining({ pmid: 'page-2-hit' }),
        expect.objectContaining({ pmid: 'page-3-hit' }),
      ]),
    );
  });

  it('parses PubMed article detail HTML into full authors, affiliations, and abstract', async () => {
    process.env.PUBMED_DETAIL_MAX_FETCHES = '3';
    const service = new ScraperService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => PUBMED_DETAIL_HTML,
      headers: {
        get: (header: string) =>
          header.toLowerCase() === 'content-type'
            ? 'text/html; charset=utf-8'
            : null,
      },
    } as Response) as typeof fetch;

    const detail = await (service as any).fetchPubmedArticleDetail(
      'https://pubmed.ncbi.nlm.nih.gov/37964458/',
    );

    expect(detail).toEqual(
      expect.objectContaining({
        detailUrl: 'https://pubmed.ncbi.nlm.nih.gov/37964458/',
        pmid: '37964458',
        citationDate: '2023 Oct',
        journal: 'Healthcare informatics research',
        doi: '10.4258/hir.2023.29.4.367',
        volume: '29',
        issue: '4',
        fullAuthors: ['Neşe Zayim', 'Yilmaz Kemal Yüce'],
        abstract:
          'Objectives: Mobile health applications can lead to cognitive overload.',
      }),
    );
    expect(detail.authorDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullName: 'Yilmaz Kemal Yüce',
          affiliations: [
            'Department of Computer Engineering, Alanya Alaaddin Keykubat University, Antalya, Türkiye.',
          ],
        }),
      ]),
    );
  });

  it('prioritizes multi-query consensus articles for detail enrichment when fetch budget is limited', async () => {
    process.env.PUBMED_DETAIL_MAX_FETCHES = '1';
    const service = new ScraperService();
    const parseSpy = jest.spyOn(
      service as any,
      'parsePubmedSearchResults',
    ) as jest.MockedFunction<(url: string) => Promise<unknown>>;
    const detailSpy = jest.spyOn(
      service as any,
      'fetchPubmedArticleDetail',
    ) as jest.MockedFunction<(url: string) => Promise<unknown>>;

    parseSpy
      .mockResolvedValueOnce({
        pageTitle: 'Run 1',
        articleCount: 2,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '20015169',
            title: 'Broad but high score',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/20015169/',
            journalCitation: 'J Med Syst. 2010 Feb;34(1):1-10.',
            authors: 'A Person, Yuce YK',
            snippet: '',
          },
          {
            pmid: '37869854',
            title: 'Consensus hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yuce YK',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 2',
        articleCount: 1,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '37869854',
            title: 'Consensus hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yuce YK',
            snippet: '',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        pageTitle: 'Run 3',
        articleCount: 1,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
        articles: [
          {
            pmid: '37869854',
            title: 'Consensus hit',
            articleUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
            journalCitation: 'Stud Health Technol Inform. 2023 Oct 20;309:262-266.',
            authors: 'Zayim N, Yuce YK',
            snippet: '',
          },
        ],
      } as never);

    detailSpy.mockResolvedValue({
      detailUrl: 'https://pubmed.ncbi.nlm.nih.gov/37869854/',
      fullAuthors: ['Yilmaz Kemal Yüce'],
      authorDetails: [],
      fetchedAt: new Date().toISOString(),
    } as never);

    await service.searchPubmedAuthor('Yılmaz Kemal Yüce', 3);

    expect(detailSpy).toHaveBeenCalledTimes(1);
    expect(detailSpy).toHaveBeenCalledWith(
      'https://pubmed.ncbi.nlm.nih.gov/37869854/',
    );
  });

  it('rejects empty PubMed author queries', async () => {
    const service = new ScraperService();

    await expect(service.searchPubmedAuthor('   ', 10)).rejects.toThrow(
      'PubMed aramasi icin yazar adi bos olamaz.',
    );
  });
});
