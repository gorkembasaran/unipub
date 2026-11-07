import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

type PubmedDetailAuthor = {
  fullName: string;
  normalizedName: string;
  affiliations: string[];
};

type PubmedArticleDetail = {
  detailUrl: string;
  pmid?: string;
  journal?: string;
  citationDate?: string;
  doi?: string;
  volume?: string;
  issue?: string;
  abstract?: string;
  fullAuthors: string[];
  authorDetails: PubmedDetailAuthor[];
  fetchedAt: string;
};

type ScopusRenderedPublication = {
  title: string;
  articleUrl?: string;
  sourceId?: string;
  doi?: string;
  journal?: string;
  authors: string[];
  authorsText?: string;
  publishedYear?: number;
  citationCount?: number;
  documentType?: string;
};

type ScopusPublicationSummary = {
  totalDocuments?: number;
  renderedDocuments?: number;
  visibleDocuments: number;
  limitedAccess: boolean;
  previewMode: boolean;
  hasVisibleList: boolean;
  documentPanelMessage?: string;
};

type ScraperFetchOptions = {
  render?: boolean;
  premium?: boolean;
  countryCode?: string;
  sessionNumber?: number;
};

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly apiKey = process.env.SCRAPERAPI_KEY ?? '';
  private readonly apiBaseUrl = 'https://api.scraperapi.com';
  private readonly requestTimeoutMs = Number(
    process.env.SCRAPERAPI_TIMEOUT_MS ?? '45000',
  );
  private readonly pubmedEstimatedResultsPerPage = Math.min(
    Math.max(Number(process.env.PUBMED_SEARCH_RESULTS_PER_PAGE ?? '10'), 1),
    100,
  );
  private readonly pubmedMaxSearchPages = Math.min(
    Math.max(Number(process.env.PUBMED_SEARCH_MAX_PAGES ?? '5'), 1),
    20,
  );
  private readonly pubmedMaxDetailFetches = Math.min(
    Math.max(Number(process.env.PUBMED_DETAIL_MAX_FETCHES ?? '3'), 0),
    10,
  );
  private readonly pubmedDetailMinScore = Math.min(
    Math.max(Number(process.env.PUBMED_DETAIL_MIN_SCORE ?? '12'), 1),
    50,
  );
  private readonly scopusRenderDetailEnabled = !['0', 'false', 'no'].includes(
    (process.env.SCOPUS_DETAIL_RENDER ?? 'true').trim().toLowerCase(),
  );
  private readonly scopusRenderCountryCode =
    process.env.SCOPUS_RENDER_COUNTRY_CODE?.trim().toLowerCase() || 'us';
  private readonly scopusRenderPremium = ['1', 'true', 'yes'].includes(
    (process.env.SCOPUS_RENDER_PREMIUM ?? 'false').trim().toLowerCase(),
  );
  private readonly scopusBaseUrl = 'https://www.scopus.com';
  private readonly staticTestUrl =
    process.env.SCRAPERAPI_TEST_URL ?? 'https://www.scopus.com/results/authorNamesList.uri?sort=count-f&src=al&sid=dcd91c65090dbc6b3bbc55bf6d1c6359&sot=al&sdt=al&sl=40&s=AUTHLASTNAME%28Yuce%29+AND+AUTHFIRST%28y%c4%b1lmaz%29&st1=Yuce&st2=y%c4%b1lmaz&orcidId=&selectionPageSearch=anl&reselectAuthor=false&activeFlag=true&showDocument=false&resultsPerPage=20&offset=1&jtp=false&currentPage=1&previousSelectionCount=0&tooManySelections=false&previousResultCount=0&authSubject=LFSC&authSubject=HLSC&authSubject=PHSC&authSubject=SOSC&exactAuthorSearch=false&showFullList=false&authorPreferredName=&origin=searchauthorfreelookup&affiliationId=&txGid=f0f9bbfc9d3d1730fd891f0a6957476d';

  async fetchStatic() {
    this.logger.log('fetchStatic started');
    return this.fetchViaScraperApi(this.staticTestUrl);
  }

  async fetchByUrl(url: string) {
    this.logger.log(`fetchByUrl started for target="${url}"`);
    return this.fetchViaScraperApi(url);
  }

  async parseStaticAuthors() {
    return this.parseAuthorsFromUrl(this.staticTestUrl);
  }

  async parseAuthorsFromUrl(url: string) {
    this.logger.log(`parseAuthorsFromUrl started for target="${url}"`);
    const fetched = await this.fetchHtmlViaScraperApi(url);
    const authors = this.extractScopusAuthorRows(fetched.body);
    this.logger.log(
      `parseAuthorsFromUrl completed with ${authors.length} authors for target="${url}"`,
    );

    return {
      source: 'ScraperAPI',
      targetUrl: url,
      fetchedAt: new Date().toISOString(),
      status: fetched.status,
      contentType: fetched.contentType,
      authorCount: authors.length,
      authors,
    };
  }

  async scrapeStaticAuthorDetail(index = 0) {
    return this.scrapeAuthorDetailFromListUrl(this.staticTestUrl, index);
  }

  async scrapeAuthorProfileUrl(authorProfileUrl: string) {
    this.logger.log(
      `scrapeAuthorProfileUrl started for profile="${authorProfileUrl}"`,
    );
    const normalizedAuthorProfileUrl = this.normalizeScopusAuthorUrl(
      this.decodeHtmlEntities(authorProfileUrl),
    );
    let detailHtml = await this.fetchHtmlViaScraperApi(normalizedAuthorProfileUrl);
    let detailParsed = this.parseAuthorDetailHtml(
      detailHtml.body,
      normalizedAuthorProfileUrl,
    );
    let renderAttempted = false;
    let renderSelected = false;
    let renderError: string | null = null;

    if (
      this.scopusRenderDetailEnabled &&
      !this.isRenderedScopusDetailHtml(detailHtml.body)
    ) {
      renderAttempted = true;
      try {
        const renderedHtml = await this.fetchHtmlViaScraperApi(
          normalizedAuthorProfileUrl,
          {
            render: true,
            premium: this.scopusRenderPremium,
            countryCode: this.scopusRenderCountryCode,
          },
        );
        const renderedParsed = this.parseAuthorDetailHtml(
          renderedHtml.body,
          normalizedAuthorProfileUrl,
        );

        if (this.isBetterScopusAuthorDetail(renderedParsed, detailParsed)) {
          detailHtml = renderedHtml;
          detailParsed = renderedParsed;
          renderSelected = true;
        }
      } catch (error) {
        renderError =
          error instanceof Error ? error.message : 'Scopus render fetch basarisiz';
        this.logger.warn(
          `Scopus render detail fetch failed for profile="${normalizedAuthorProfileUrl}" -> ${renderError}`,
        );
      }
    }

    this.logger.log(
      `scrapeAuthorProfileUrl completed for profile="${normalizedAuthorProfileUrl}"`,
    );

    return {
      source: 'ScraperAPI',
      selectedAuthor: {
        authorProfileUrl: normalizedAuthorProfileUrl,
      },
      detailParsed,
      detailScrape: {
        source: 'ScraperAPI',
        targetUrl: normalizedAuthorProfileUrl,
        fetchedAt: new Date().toISOString(),
        status: detailHtml.status,
        contentType: detailHtml.contentType,
        bodyLength: detailHtml.body.length,
        bodyPreview: detailHtml.body.slice(0, 3000),
        renderAttempted,
        renderSelected,
        renderError,
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  async scrapeAuthorDetailFromListUrl(listUrl: string, index = 0) {
    this.logger.log(
      `scrapeAuthorDetailFromListUrl started for listUrl="${listUrl}" index=${index}`,
    );
    const parsed = await this.parseAuthorsFromUrl(listUrl);

    if (parsed.authorCount === 0) {
      throw new BadGatewayException(
        'Author listesi bos dondu. Scopus sayfasinda parse edilebilir yazar bulunamadi.',
      );
    }

    if (index < 0 || index >= parsed.authorCount) {
      throw new BadGatewayException(
        `Gecersiz index: ${index}. Aralik: 0 - ${parsed.authorCount - 1}`,
      );
    }

    const selectedAuthor = parsed.authors[index];
    const profileResult = await this.scrapeAuthorProfileUrl(
      selectedAuthor.authorProfileUrl,
    );
    this.logger.log(
      `scrapeAuthorDetailFromListUrl completed for listUrl="${listUrl}" index=${index}`,
    );

    return {
      source: 'ScraperAPI',
      listUrl,
      selectedIndex: index, 
      selectedAuthor: {
        ...selectedAuthor,
        authorProfileUrl: profileResult.selectedAuthor.authorProfileUrl,
      },
      detailParsed: profileResult.detailParsed,
      detailScrape: profileResult.detailScrape,
      fetchedAt: new Date().toISOString(),
    };
  }

  async parsePubmedSearchResults(url: string) {
    this.logger.log(`parsePubmedSearchResults started for target="${url}"`);
    const fetched = await this.fetchHtmlViaScraperApi(url);
    const articles = this.extractPubmedArticles(fetched.body);
    const pagination = this.extractPubmedPagination(fetched.body);
    const title = this.extractFirstMatch(
      fetched.body,
      /<title>([\s\S]*?)<\/title>/i,
    );

    this.logger.log(
      `parsePubmedSearchResults completed with ${articles.length} articles for target="${url}"`,
    );
    return {
      source: 'ScraperAPI',
      targetUrl: url,
      fetchedAt: new Date().toISOString(),
      status: fetched.status,
      contentType: fetched.contentType,
      pageTitle: title,
      articleCount: articles.length,
      pagination,
      articles,
    };
  }

  async searchPubmedAuthorStatic(limit = 20) {
    return this.searchPubmedAuthor('Yılmaz Kemal Yüce', limit);
  }

  async searchPubmedAuthor(query: string, limit = 20) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new BadGatewayException('PubMed aramasi icin yazar adi bos olamaz.');
    }

    const parts = this.splitAuthorName(trimmedQuery);
    const candidateTerms = this.buildPubmedAuthorTerms(trimmedQuery, parts);
    this.logger.log(
      `searchPubmedAuthor started query="${trimmedQuery}" candidates=${candidateTerms.length} limit=${limit}`,
    );

    const aggregate = new Map<
      string,
      {
        pmid: string | null;
        title: string | null;
        articleUrl: string | null;
        journalCitation: string | null;
        authors: string | null;
        snippet: string | null;
        score: number;
        matchedBy: string[];
        detail?: PubmedArticleDetail | null;
      }
    >();

    const runs: Array<{
      term: string;
      url: string;
      pageTitle: string | null;
      page: number;
      totalPages: number;
      articleCount: number;
      matchedCount: number;
    }> = [];

    for (const term of candidateTerms) {
      let currentPage = 1;
      let totalPages = 1;
      const pageBudget = this.resolvePubmedSearchPageBudget(limit);

      while (
        currentPage <= pageBudget &&
        currentPage <= totalPages
      ) {
        const url = this.buildPubmedSearchUrl(term, currentPage);
        const parsed = await this.parsePubmedSearchResults(url);
        totalPages = parsed.pagination.totalPages;
        let matchedCount = 0;

        for (const article of parsed.articles) {
          const score = this.scorePubmedArticleAuthorMatch(
            trimmedQuery,
            parts,
            article.authors ?? '',
          );

          if (score <= 0) {
            continue;
          }
          matchedCount += 1;

          const fallbackKey = `${term}:page:${currentPage}:index:${matchedCount}`;
          const key = article.pmid || article.articleUrl || article.title || fallbackKey;
          const existing = aggregate.get(key);
          if (!existing) {
            aggregate.set(key, {
              ...article,
              score,
              matchedBy: [term],
            });
            continue;
          }

          existing.score = Math.max(existing.score, score);
          if (!existing.matchedBy.includes(term)) {
            existing.matchedBy.push(term);
          }
        }

        runs.push({
          term,
          url,
          page: currentPage,
          totalPages,
          pageTitle: parsed.pageTitle,
          articleCount: parsed.articleCount,
          matchedCount,
        });

        if (
          parsed.articleCount === 0 ||
          !parsed.pagination.hasNextPage ||
          currentPage >= totalPages
        ) {
          break;
        }

        currentPage += 1;
      }
    }

    const matchedArticles = await this.enrichPubmedMatchedArticles(
      Array.from(aggregate.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
    );

    this.logger.log(
      `searchPubmedAuthor completed query="${trimmedQuery}" matched=${matchedArticles.length}`,
    );

    return {
      source: 'PubMed+ScraperAPI',
      query: trimmedQuery,
      normalizedQuery: this.normalizeForSearch(trimmedQuery),
      nameParts: parts,
      queryCandidates: candidateTerms,
      runs,
      totalMatched: matchedArticles.length,
      matchedArticles,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchScopusAuthorsStatic(limit = 10) {
    return this.searchScopusAuthors('Yılmaz Kemal Yüce', limit);
  }

  async searchScopusAuthors(query: string, limit = 10) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new BadGatewayException('Scopus aramasi icin yazar adi bos olamaz.');
    }

    const searchUrl = this.buildScopusAuthorSearchUrl(trimmedQuery);
    this.logger.log(
      `searchScopusAuthors started query="${trimmedQuery}" limit=${limit} url="${searchUrl}"`,
    );

    const parsed = await this.parseAuthorsFromUrl(searchUrl);
    const rankedAuthors = this.rankScopusAuthors(trimmedQuery, parsed.authors, limit);

    this.logger.log(
      `searchScopusAuthors completed query="${trimmedQuery}" raw=${parsed.authorCount} ranked=${rankedAuthors.length}`,
    );

    return {
      source: 'Scopus+ScraperAPI',
      query: trimmedQuery,
      normalizedQuery: this.normalizeForSearch(trimmedQuery),
      generatedUrl: searchUrl,
      nameParts: this.splitAuthorName(trimmedQuery),
      totalRaw: parsed.authorCount,
      totalRanked: rankedAuthors.length,
      authors: rankedAuthors,
      fetchedAt: new Date().toISOString(),
    };
  }

  buildScopusAuthorDetailUrl(authorId: string) {
    const normalizedId = authorId.trim();
    if (!normalizedId) {
      throw new BadGatewayException('Scopus authorId bos olamaz.');
    }

    return `${this.scopusBaseUrl}/authid/detail.uri?authorId=${encodeURIComponent(normalizedId)}`;
  }

  async scrapeScopusAuthorDetailById(authorId: string) {
    const detailUrl = this.buildScopusAuthorDetailUrl(authorId);
    const detail = await this.scrapeAuthorProfileUrl(detailUrl);

    return {
      ...detail,
      selectedAuthor: {
        ...detail.selectedAuthor,
        authorId: authorId.trim(),
      },
      detailUrl,
    };
  }

  private async fetchViaScraperApi(targetUrl: string) {
    this.logger.log(`fetchViaScraperApi started for target="${targetUrl}"`);
    const fetched = await this.fetchHtmlViaScraperApi(targetUrl);
    this.logger.log(
      `fetchViaScraperApi completed for target="${targetUrl}" status=${fetched.status}`,
    );

    return {
      source: 'ScraperAPI',
      targetUrl,
      fetchedAt: new Date().toISOString(),
      status: fetched.status,
      contentType: fetched.contentType,
      bodyLength: fetched.body.length,
      bodyPreview: fetched.body.slice(0, 3000),
    };
  }

  private buildScopusAuthorSearchUrl(fullName: string) {
    const parts = this.splitAuthorName(fullName);
    const queryDsl = parts.firstName
      ? `AUTHLASTNAME(${parts.lastName}) AND AUTHFIRST(${parts.firstName})`
      : `AUTHLASTNAME(${parts.lastName})`;

    const params = new URLSearchParams();
    params.set('sort', 'count-f');
    params.set('src', 'al');
    params.set('sot', 'al');
    params.set('sdt', 'al');
    params.set('sl', String(Math.max(10, Math.min(80, fullName.length + 20))));
    params.set('s', queryDsl);
    params.set('st1', parts.lastName);
    params.set('st2', parts.firstName);
    params.set('orcidId', '');
    params.set('selectionPageSearch', 'anl');
    params.set('reselectAuthor', 'false');
    params.set('activeFlag', 'true');
    params.set('showDocument', 'false');
    params.set('resultsPerPage', '20');
    params.set('offset', '1');
    params.set('jtp', 'false');
    params.set('currentPage', '1');
    params.set('previousSelectionCount', '0');
    params.set('tooManySelections', 'false');
    params.set('previousResultCount', '0');
    params.append('authSubject', 'LFSC');
    params.append('authSubject', 'HLSC');
    params.append('authSubject', 'PHSC');
    params.append('authSubject', 'SOSC');
    params.set('exactAuthorSearch', 'false');
    params.set('showFullList', 'false');
    params.set('authorPreferredName', '');
    params.set('origin', 'searchauthorfreelookup');
    params.set('affiliationId', '');

    return `${this.scopusBaseUrl}/results/authorNamesList.uri?${params.toString()}`;
  }

  private splitAuthorName(fullName: string) {
    const tokens = fullName
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return { firstName: '', lastName: '' };
    }

    if (tokens.length === 1) {
      return { firstName: '', lastName: tokens[0] };
    }

    const lastName = tokens[tokens.length - 1];
    const firstName = tokens.slice(0, -1).join(' ');
    return { firstName, lastName };
  }

  private rankScopusAuthors(
    rawQuery: string,
    authors: Array<{
      authorName: string;
      authorProfileUrl: string;
      authorId: string | null;
      documents: number | null;
      affiliation: string | null;
      city: string | null;
      country: string | null;
      rowTexts: string[];
    }>,
    limit: number,
  ) {
    const normalizedQuery = this.normalizeForSearch(rawQuery);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    return authors
      .map((author) => {
        const normalizedName = this.normalizeForSearch(author.authorName);
        const matchedTokens = queryTokens.filter((token) =>
          normalizedName.includes(token),
        );

        let score = matchedTokens.length * 3;
        if (normalizedName === normalizedQuery) {
          score += 10;
        } else if (normalizedName.includes(normalizedQuery)) {
          score += 5;
        }

        return {
          authorName: author.authorName,
          normalizedName,
          authorId: author.authorId,
          authorProfileUrl: author.authorProfileUrl,
          documents: author.documents,
          affiliation: author.affiliation,
          city: author.city,
          country: author.country,
          rowTexts: author.rowTexts,
          matchedTokens,
          score,
        };
      })
      .sort((a, b) => b.score - a.score || a.authorName.localeCompare(b.authorName))
      .slice(0, limit);
  }

  private normalizeForSearch(value: string) {
    return value
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async fetchHtmlViaScraperApi(
    targetUrl: string,
    options?: ScraperFetchOptions,
  ) {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'SCRAPERAPI_KEY tanimli degil. .env icine ekleyin.',
      );
    }

    const params = new URLSearchParams({
      api_key: this.apiKey,
      url: targetUrl,
    });
    if (options?.render) {
      params.set('render', 'true');
    }
    if (options?.premium) {
      params.set('premium', 'true');
    }
    if (options?.countryCode) {
      params.set('country_code', options.countryCode);
    }
    if (
      typeof options?.sessionNumber === 'number' &&
      Number.isFinite(options.sessionNumber)
    ) {
      params.set('session_number', String(options.sessionNumber));
    }

    const requestUrl = `${this.apiBaseUrl}?${params.toString()}`;
    this.logger.log(
      `ScraperAPI request -> ${this.redactSensitiveQueryParams(requestUrl)}`,
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `ScraperAPI zaman asimi: ${this.requestTimeoutMs}ms`
          : error instanceof Error && error.message
            ? `ScraperAPI baglantisi basarisiz: ${error.message}`
            : 'ScraperAPI baglantisi basarisiz.';
      this.logger.warn(`ScraperAPI request failed for target="${targetUrl}" -> ${message}`);
      throw new BadGatewayException(message);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const errorMessage = this.buildScraperApiErrorMessage(
        targetUrl,
        response.status,
        response.statusText,
        errorBody,
        options,
      );
      this.logger.warn(
        `ScraperAPI request failed: ${response.status} ${response.statusText}`,
      );
      throw new BadGatewayException(errorMessage);
    }

    const body = await response.text();
    this.logger.log(
      `ScraperAPI request completed: status=${response.status} contentLength=${body.length}`,
    );

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
    };
  }

  private extractScopusAuthorRows(html: string) {
    const matches: Array<{
      authorName: string;
      authorProfileUrl: string;
      authorId: string | null;
      documents: number | null;
      affiliation: string | null;
      city: string | null;
      country: string | null;
      rowTexts: string[];
    }> = [];
    const seen = new Set<string>();
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1] ?? '';
      const anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let anchorMatch: RegExpExecArray | null;

      while ((anchorMatch = anchorRegex.exec(rowHtml)) !== null) {
        const href = anchorMatch[1] ?? '';
        const labelHtml = anchorMatch[2] ?? '';
        const label = this.normalizeText(this.stripTags(labelHtml));

        if (!this.isScopusAuthorLink(href)) {
          continue;
        }

        if (!label || label.length < 3 || !label.includes(',')) {
          continue;
        }

        const authorProfileUrl = this.normalizeScopusAuthorUrl(
          this.toAbsoluteScopusUrl(href),
        );
        const key = `${label}::${authorProfileUrl}`;
        if (seen.has(key)) {
          continue;
        }

        const rowTexts = this.extractTableRowTexts(rowHtml);
        const structured = this.extractScopusRowMeta(rowTexts);

        seen.add(key);
        matches.push({
          authorName: label,
          authorProfileUrl,
          authorId: this.extractScopusAuthorId(authorProfileUrl),
          documents: structured.documents,
          affiliation: structured.affiliation,
          city: structured.city,
          country: structured.country,
          rowTexts,
        });
      }
    }

    return matches;
  }

  private redactSensitiveQueryParams(url: string) {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('api_key')) {
        parsed.searchParams.set('api_key', '[redacted]');
      }
      return parsed.toString();
    } catch {
      return url.replace(/([?&]api_key=)[^&]+/i, '$1[redacted]');
    }
  }

  private extractTableRowTexts(rowHtml: string) {
    const cells: string[] = [];
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const text = this.normalizeText(this.stripTags(cellMatch[1] ?? ''));
      if (text) {
        cells.push(text);
      }
    }

    return cells;
  }

  private extractScopusRowMeta(rowTexts: string[]) {
    if (rowTexts.length === 0) {
      return {
        documents: null,
        affiliation: null,
        city: null,
        country: null,
      };
    }

    // Typical Scopus row shape: [index, author, documents, affiliation, city, country]
    const country = rowTexts.length >= 1 ? rowTexts[rowTexts.length - 1] : null;
    const city = rowTexts.length >= 2 ? rowTexts[rowTexts.length - 2] : null;

    const numericCandidate = rowTexts.find((cell) => /^\d{1,6}$/.test(cell));
    const documents = numericCandidate ? Number(numericCandidate) : null;

    let affiliation: string | null = null;
    if (rowTexts.length >= 4) {
      affiliation = rowTexts[3] ?? null;
    }

    if (!affiliation) {
      affiliation =
        rowTexts.find((cell) =>
          /(universit|üniversit|institute|hospital|faculty|department|bolumu|bölümü)/i.test(
            cell,
          ),
        ) ?? null;
    }

    return {
      documents,
      affiliation,
      city,
      country,
    };
  }

  private extractScopusAuthorId(url: string) {
    const match = url.match(/[?&]authorId=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  private isScopusAuthorLink(href: string) {
    return (
      href.includes('/authid/detail.uri') ||
      href.includes('authorId=') ||
      href.includes('authorDetails')
    );
  }

  private toAbsoluteScopusUrl(href: string) {
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    if (href.startsWith('/')) {
      return `${this.scopusBaseUrl}${href}`;
    }

    return `${this.scopusBaseUrl}/${href}`;
  }

  private stripTags(value: string) {
    return value.replace(/<[^>]*>/g, ' ');
  }

  private normalizeText(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private decodeHtmlEntities(value: string) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private parseAuthorDetailHtml(html: string, url: string) {
    const title = this.extractFirstMatch(html, /<title>([\s\S]*?)<\/title>/i);
    const robots = this.extractFirstMatch(
      html,
      /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i,
    );
    const baseHref = this.extractFirstMatch(
      html,
      /<base[^>]*href=["']([^"']*)["']/i,
    );
    const accountName = this.extractFirstMatch(
      html,
      /accountName\s*:\s*"([^"]*)"/i,
    );
    const accessType = this.extractFirstMatch(
      html,
      /accessType\s*:\s*"([^"]*)"/i,
    );
    const userPolicy = this.extractFirstMatch(
      html,
      /userPolicy\s*:\s*"([^"]*)"/i,
    );
    const prompt = this.extractFirstMatch(html, /prompt\s*:\s*"([^"]*)"/i);
    const pageName = this.extractFirstMatch(html, /name\s*:\s*"([^"]*)"/i);
    const secondaryProductName = this.extractFirstMatch(
      html,
      /secondaryProductName\s*:\s*"([^"]*)"/i,
    );
    const authorIdFromUrl =
      this.extractFirstMatch(url, /[?&](?:authorID|authorId)=([^&]+)/i) ?? null;
    const authorNameFromTitle = this.extractAuthorNameFromTitle(title);
    const pageType = this.detectScopusPageType(html, title);
    const renderedDetail = this.extractRenderedScopusDetail(html);
    const metrics = {
      documents:
        renderedDetail.metrics.documents ?? this.extractSimpleScopusMetrics(html).documents,
      citations:
        renderedDetail.metrics.citations ?? this.extractSimpleScopusMetrics(html).citations,
      hIndex:
        renderedDetail.metrics.hIndex ?? this.extractSimpleScopusMetrics(html).hIndex,
    };

    const loginRequired =
      html.includes('SIGN_IN:START') ||
      html.includes('id.elsevier.com') ||
      (title?.toLowerCase() ?? '').includes('welcome');

    return {
      pageType,
      loginRequired,
      renderMode: renderedDetail.renderMode,
      previewMode: renderedDetail.previewMode,
      authorId: renderedDetail.authorId ?? authorIdFromUrl,
      authorName: renderedDetail.authorName ?? authorNameFromTitle,
      authorProfileUrl: authorIdFromUrl
        ? `${this.scopusBaseUrl}/authid/detail.uri?authorId=${authorIdFromUrl}`
        : null,
      institution: renderedDetail.institution,
      city: renderedDetail.city,
      country: renderedDetail.country,
      orcid: renderedDetail.orcid,
      title,
      baseHref,
      robots,
      pageName,
      secondaryProductName,
      accountName,
      accessType,
      userPolicy,
      prompt,
      metrics,
      tabCounts: renderedDetail.tabCounts,
      publicationSummary: renderedDetail.publicationSummary,
      publications: renderedDetail.publications,
      detectedAt: new Date().toISOString(),
    };
  }

  private extractRenderedScopusDetail(html: string) {
    const authorName =
      this.extractFirstMatch(
        html,
        /<h1[^>]*data-testid="author-profile-name"[^>]*>([\s\S]*?)<\/h1>/i,
      ) ?? null;
    const institutionText = this.extractTextAroundMarker(
      html,
      'data-testid="authorInstitution"',
      900,
    );
    const institutionData = this.parseScopusInstitutionText(institutionText);
    const authorId =
      this.extractFirstMatch(html, /Scopus ID:\s*([0-9]+)/i) ?? null;
    const orcid =
      this.extractFirstMatch(
        html,
        /orcid\.org\/([0-9X-]{15,25})/i,
      ) ?? null;
    const documentCount = this.extractScopusMetricCount(
      html,
      'metrics-section-document-count',
    );
    const citationCount = this.extractScopusMetricCount(
      html,
      'metrics-section-citations-count',
    );
    const hIndex = this.extractScopusMetricCount(
      html,
      'metrics-section-h-index',
    );
    const publications = this.extractRenderedScopusPublications(html);
    const publicationSummary = this.extractScopusPublicationSummary(
      html,
      publications,
      documentCount,
    );

    return {
      renderMode: this.isRenderedScopusDetailHtml(html) ? 'rendered' : 'static',
      previewMode:
        /scopus preview/i.test(html) ||
        publicationSummary.previewMode ||
        /preview mode/i.test(this.normalizeText(this.stripTags(html))),
      authorName,
      authorId,
      institution: institutionData.institution,
      city: institutionData.city,
      country: institutionData.country,
      orcid,
      metrics: {
        documents: documentCount,
        citations: citationCount,
        hIndex,
      },
      tabCounts: {
        documents: this.extractScopusTabCount(html, 'documents'),
        citedBy: this.extractScopusTabCount(html, 'cited-by'),
        preprints: this.extractScopusTabCount(html, 'preprints'),
        coAuthors: this.extractScopusTabCount(html, 'co-authors'),
        grants: this.extractScopusTabCount(html, 'grants'),
      },
      publicationSummary,
      publications,
    };
  }

  private parseScopusInstitutionText(value: string | null) {
    if (!value) {
      return {
        institution: null,
        city: null,
        country: null,
      };
    }

    const cleaned = (
      value
      .replace(/data-testid="authorInstitution">?/gi, '')
      .replace(/This link is disabled\./gi, '')
      .replace(/Scopus ID:\s*[0-9]+/gi, '')
      .split(/\b(?:ORCID|Citations by|Documents|h-index|Show all information)\b/i)[0]
        ?.trim() ?? ''
    )
      .replace(/\s+,/g, ',')
      .trim();
    const parts = cleaned
      .split(/\s*,\s*/)
      .map((part) => part.replace(/<.*$/g, '').trim())
      .filter(Boolean);

    return {
      institution: parts[0] ?? null,
      city: parts[1] ?? null,
      country: parts[2] ?? null,
    };
  }

  private extractScopusMetricCount(html: string, marker: string) {
    const slice = this.extractSliceAroundMarker(html, marker, 2000);
    if (!slice) {
      return null;
    }

    const direct = slice.match(
      /data-testid="unclickable-count"[^>]*>([\d,]+)<\/span>/i,
    );
    if (direct?.[1]) {
      return this.parseNumericText(direct[1]);
    }

    return this.parseNumericText(this.normalizeText(this.stripTags(slice)));
  }

  private extractScopusTabCount(html: string, tabId: string) {
    const slice = this.extractSliceAroundMarker(html, `id="${tabId}"`, 400);
    if (!slice) {
      return null;
    }

    const match = slice.match(/\((\d{1,6})\)/);
    return match?.[1] ? Number(match[1]) : null;
  }

  private extractScopusPublicationSummary(
    html: string,
    publications: ScopusRenderedPublication[],
    fallbackTotalDocuments: number | null,
  ): ScopusPublicationSummary {
    const documentsPanelHtml = this.extractScopusDocumentsPanelHtml(html);
    const panelText = documentsPanelHtml
      ? this.normalizeText(this.stripTags(documentsPanelHtml))
      : '';
    const countMatch = panelText.match(/(\d{1,4})\s+of\s+(\d{1,6})\s+documents/i);
    const renderedDocuments = countMatch?.[1]
      ? Number(countMatch[1])
      : publications.length > 0
        ? publications.length
        : undefined;
    const totalDocuments = countMatch?.[2]
      ? Number(countMatch[2])
      : fallbackTotalDocuments ?? undefined;
    const documentPanelMessage = panelText.includes(
      'Results list, nothing to display.',
    )
      ? 'Results list, nothing to display.'
      : undefined;

    return {
      totalDocuments,
      renderedDocuments,
      visibleDocuments: publications.length,
      limitedAccess: /limited access/i.test(panelText),
      previewMode:
        /scopus preview/i.test(html) || /preview mode/i.test(panelText),
      hasVisibleList: publications.length > 0,
      documentPanelMessage,
    };
  }

  private extractRenderedScopusPublications(html: string) {
    const panelHtml = this.extractScopusDocumentsPanelHtml(html);
    if (!panelHtml) {
      return [] as ScopusRenderedPublication[];
    }

    const publications: ScopusRenderedPublication[] = [];
    const seen = new Set<string>();
    const anchorRegex =
      /<a\b[^>]*href="([^"]*(?:\/record\/display\.uri[^"]*|[?&]eid=[^"]+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;

    while ((anchorMatch = anchorRegex.exec(panelHtml)) !== null) {
      const href = this.decodeHtmlEntities(anchorMatch[1] ?? '');
      const title = this.normalizeText(this.stripTags(anchorMatch[2] ?? ''));
      if (!title || title.length < 8) {
        continue;
      }

      const publicationBlock = this.extractScopusPublicationBlock(
        panelHtml,
        anchorMatch.index,
        anchorRegex.lastIndex,
      );
      const blockText = this.normalizeText(this.stripTags(publicationBlock));
      const key = `${title}::${href}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const authorsText =
        this.extractFirstMatch(
          publicationBlock,
          /data-testid="document-authors"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        this.extractFirstMatch(
          publicationBlock,
          /class="[^"]*authors[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        null;
      const journal =
        this.extractFirstMatch(
          publicationBlock,
          /data-testid="source-title"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        this.extractFirstMatch(
          publicationBlock,
          /class="[^"]*source-title[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        null;
      const citationCount =
        this.parseNumericText(
          this.extractFirstMatch(publicationBlock, /Cited by\s+(\d{1,6})/i) ?? '',
        ) ?? null;
      const doi = this.extractDoiFromText(blockText);
      const publishedYear = this.extractYear(blockText) ?? undefined;
      const documentType =
        this.extractFirstMatch(
          publicationBlock,
          /data-testid="document-type"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        this.extractFirstMatch(
          publicationBlock,
          /class="[^"]*document-type[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i,
        ) ??
        undefined;
      const articleUrl = this.toAbsoluteScopusUrl(href);
      const sourceId =
        this.extractFirstMatch(articleUrl, /[?&]eid=([^&]+)/i) ?? undefined;

      publications.push({
        title,
        articleUrl,
        sourceId,
        doi: doi ?? undefined,
        journal: journal ?? undefined,
        authors: this.splitScopusAuthorText(authorsText ?? undefined),
        authorsText: authorsText ?? undefined,
        publishedYear,
        citationCount: citationCount ?? undefined,
        documentType,
      });
    }

    return publications;
  }

  private extractScopusDocumentsPanelHtml(html: string) {
    const patterns = [
      /<div id="documents-panel"[\s\S]*?(?=<div id="impact-panel"|<div id="cited-by-panel"|<div id="preprints-panel"|<div id="co-authors-panel"|<div id="topics-panel"|<div id="grants-panel"|<\/scopus-author-profile-page-control-microui>)/i,
      /<div id="documents-panel"[\s\S]*?(?=<div id="[^"]+-panel"|<\/scopus-author-profile-page-control-microui>)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[0]) {
        return match[0];
      }
    }

    return null;
  }

  private extractScopusPublicationBlock(
    panelHtml: string,
    anchorStart: number,
    anchorEnd: number,
  ) {
    const articleStart = panelHtml.lastIndexOf('<article', anchorStart);
    const articleEnd =
      articleStart >= 0 ? panelHtml.indexOf('</article>', anchorEnd) : -1;
    if (articleStart >= 0 && articleEnd > articleStart) {
      return panelHtml.slice(articleStart, articleEnd + '</article>'.length);
    }

    const listItemStart = panelHtml.lastIndexOf('<li', anchorStart);
    const listItemEnd =
      listItemStart >= 0 ? panelHtml.indexOf('</li>', anchorEnd) : -1;
    if (listItemStart >= 0 && listItemEnd > listItemStart) {
      return panelHtml.slice(listItemStart, listItemEnd + '</li>'.length);
    }

    return panelHtml.slice(
      Math.max(0, anchorStart - 1500),
      Math.min(panelHtml.length, anchorEnd + 2500),
    );
  }

  private splitScopusAuthorText(value?: string | null) {
    if (!value?.trim()) {
      return [] as string[];
    }

    return value
      .replace(/\s+/g, ' ')
      .split(/\s*;\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private extractDoiFromText(value: string) {
    const match = value.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    return match?.[0] ? match[0].toLowerCase() : null;
  }

  private extractYear(value: string) {
    const match = value.match(/\b(19|20)\d{2}\b/);
    return match?.[0] ? Number(match[0]) : null;
  }

  private extractTextAroundMarker(
    html: string,
    marker: string,
    length = 600,
  ) {
    const slice = this.extractSliceAroundMarker(html, marker, length);
    if (!slice) {
      return null;
    }

    return this.normalizeText(this.stripTags(slice));
  }

  private extractSliceAroundMarker(html: string, marker: string, length = 600) {
    const index = html.indexOf(marker);
    if (index < 0) {
      return null;
    }

    const startIndex = html.lastIndexOf('<', index);
    const safeStartIndex = startIndex >= 0 ? startIndex : index;

    return html.slice(
      safeStartIndex,
      Math.min(html.length, safeStartIndex + length),
    );
  }

  private parseNumericText(value: string) {
    const match = value.match(/(\d[\d,]*)/);
    if (!match?.[1]) {
      return null;
    }

    const parsed = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isRenderedScopusDetailHtml(html: string) {
    return (
      html.includes('scopus-author-profile-page-control-microui') &&
      (html.includes('class="hydrated"') ||
        html.includes('data-testid="author-profile-name"'))
    );
  }

  private isBetterScopusAuthorDetail(
    candidate: Record<string, unknown>,
    current: Record<string, unknown>,
  ) {
    const candidatePublications = Array.isArray(candidate.publications)
      ? candidate.publications.length
      : 0;
    const currentPublications = Array.isArray(current.publications)
      ? current.publications.length
      : 0;
    const candidateMetrics =
      candidate.metrics && typeof candidate.metrics === 'object'
        ? candidate.metrics
        : null;
    const currentMetrics =
      current.metrics && typeof current.metrics === 'object'
        ? current.metrics
        : null;
    const candidateMetricCount = [
      candidateMetrics &&
      typeof candidateMetrics === 'object' &&
      'documents' in candidateMetrics
        ? (candidateMetrics.documents as number | null | undefined)
        : null,
      candidateMetrics &&
      typeof candidateMetrics === 'object' &&
      'citations' in candidateMetrics
        ? (candidateMetrics.citations as number | null | undefined)
        : null,
      candidateMetrics &&
      typeof candidateMetrics === 'object' &&
      'hIndex' in candidateMetrics
        ? (candidateMetrics.hIndex as number | null | undefined)
        : null,
    ].filter((item) => typeof item === 'number').length;
    const currentMetricCount = [
      currentMetrics &&
      typeof currentMetrics === 'object' &&
      'documents' in currentMetrics
        ? (currentMetrics.documents as number | null | undefined)
        : null,
      currentMetrics &&
      typeof currentMetrics === 'object' &&
      'citations' in currentMetrics
        ? (currentMetrics.citations as number | null | undefined)
        : null,
      currentMetrics &&
      typeof currentMetrics === 'object' &&
      'hIndex' in currentMetrics
        ? (currentMetrics.hIndex as number | null | undefined)
        : null,
    ].filter((item) => typeof item === 'number').length;

    if (candidatePublications !== currentPublications) {
      return candidatePublications > currentPublications;
    }

    if (candidateMetricCount !== currentMetricCount) {
      return candidateMetricCount > currentMetricCount;
    }

    return candidate.renderMode === 'rendered' && current.renderMode !== 'rendered';
  }

  private buildScraperApiErrorMessage(
    targetUrl: string,
    status: number | string,
    statusText: string,
    errorBody: string,
    options?: ScraperFetchOptions,
  ) {
    let message = `ScraperAPI hatasi: ${status} ${statusText}`;
    const normalizedBody = errorBody.toLowerCase();
    const isScopus = targetUrl.includes('scopus.com');

    if (
      isScopus &&
      /premium=true|ultra_premium=true/.test(normalizedBody)
    ) {
      message +=
        ' | Scopus hedefi premium/ultra-premium veya render ayari gerektiriyor olabilir.';
    }

    if (
      isScopus &&
      options?.render &&
      /welcome|id\.elsevier\.com|authorization\.oauth2/.test(normalizedBody)
    ) {
      message +=
        ' | Render denemesine ragmen Scopus document sayfasi giris istiyor.';
    }

    return message;
  }

  private extractFirstMatch(value: string, regex: RegExp) {
    const match = value.match(regex);
    if (!match?.[1]) {
      return null;
    }

    return this.normalizeText(this.stripTags(match[1]));
  }

  private normalizeScopusAuthorUrl(url: string) {
    const authorId = this.extractFirstMatch(
      url,
      /[?&](?:authorID|authorId)=([^&]+)/i,
    );

    if (!authorId) {
      return url;
    }

    return `${this.scopusBaseUrl}/authid/detail.uri?authorId=${authorId}`;
  }

  private extractAuthorNameFromTitle(title: string | null) {
    if (!title) {
      return null;
    }

    const match = title.match(
      /scopus(?:\s+preview)?\s*-\s*(.*?)\s*-\s*author details/i,
    );
    if (!match?.[1]) {
      return null;
    }

    return this.normalizeText(match[1]);
  }

  private detectScopusPageType(html: string, title: string | null) {
    if (html.includes('SIGN_IN:START') || html.includes('id.elsevier.com')) {
      return 'login';
    }

    if (title?.toLowerCase().includes('author details')) {
      return 'author-detail';
    }

    if (html.includes('name : "warn"') || html.includes('name":"warn"')) {
      return 'warning';
    }

    return 'unknown';
  }

  private extractSimpleScopusMetrics(html: string) {
    const compact = this.normalizeText(this.stripTags(html));

    return {
      documents: this.extractNumericMetric(compact, /documents?\s*(\d{1,6})/i),
      citations: this.extractNumericMetric(compact, /citations?\s*(\d{1,8})/i),
      hIndex: this.extractNumericMetric(compact, /h[\s-]?index\s*(\d{1,4})/i),
    };
  }

  private extractNumericMetric(value: string, regex: RegExp) {
    const match = value.match(regex);
    if (!match?.[1]) {
      return null;
    }

    const parsed = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private extractPubmedArticles(html: string) {
    const blocks: string[] = [];
    const results: Array<{
      pmid: string | null;
      title: string | null;
      articleUrl: string | null;
      journalCitation: string | null;
      authors: string | null;
      snippet: string | null;
    }> = [];

    const articleRegex =
      /<article[^>]*class="[^"]*full-docsum[^"]*"[^>]*>[\s\S]*?<\/article>/gi;
    let articleMatch: RegExpExecArray | null;
    while ((articleMatch = articleRegex.exec(html)) !== null) {
      blocks.push(articleMatch[0]);
    }

    for (const block of blocks) {
      const rawHref = this.extractFirstMatch(
        block,
        /<a[^>]*class="[^"]*docsum-title[^"]*"[^>]*href="([^"]+)"/i,
      );
      const title = this.extractFirstMatch(
        block,
        /<a[^>]*class="[^"]*docsum-title[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const pmid = this.extractFirstMatch(rawHref ?? '', /\/(\d+)\/?$/);
      const journalCitation = this.extractFirstMatch(
        block,
        /<span[^>]*class="[^"]*docsum-journal-citation[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const authors = this.extractFirstMatch(
        block,
        /<span[^>]*class="[^"]*docsum-authors[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const snippet = this.extractFirstMatch(
        block,
        /<div[^>]*class="[^"]*full-view-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );

      results.push({
        pmid,
        title,
        articleUrl: rawHref ? this.toAbsolutePubmedUrl(rawHref) : null,
        journalCitation,
        authors,
        snippet,
      });
    }

    return results;
  }

  private extractPubmedPagination(html: string) {
    const currentPageRaw =
      this.extractFirstMatch(
        html,
        /<input[^>]*class="[^"]*page-number[^"]*"[^>]*value="(\d+)"/i,
      ) ?? '1';
    const totalPagesRaw =
      this.extractFirstMatch(
        html,
        /<label class="of-total-pages">of\s+(\d+)<\/label>/i,
      ) ??
      this.extractFirstMatch(
        html,
        /<button[^>]*class="[^"]*last-page-btn[^"]*"[^>]*data-max-page="(\d+)"/i,
      ) ??
      currentPageRaw;

    const currentPage = Math.max(Number(currentPageRaw) || 1, 1);
    const totalPages = Math.max(Number(totalPagesRaw) || currentPage, currentPage);

    return {
      currentPage,
      totalPages,
      hasNextPage: currentPage < totalPages,
    };
  }

  private buildPubmedSearchUrl(term: string, page = 1) {
    const params = new URLSearchParams({
      term,
    });
    if (page > 1) {
      params.set('page', String(page));
    }
    return `https://pubmed.ncbi.nlm.nih.gov/?${params.toString()}`;
  }

  private resolvePubmedSearchPageBudget(limit: number) {
    const requestedPages = Math.ceil(
      Math.max(limit, 1) / this.pubmedEstimatedResultsPerPage,
    );
    return Math.max(this.pubmedMaxSearchPages, requestedPages);
  }

  private buildPubmedAuthorTerms(
    fullName: string,
    parts: { firstName: string; lastName: string },
  ) {
    const normalizedLast = this.normalizeForSearch(parts.lastName)
      .split(' ')[0]
      ?.trim();
    const firstTokens = this.normalizeForSearch(parts.firstName)
      .split(' ')
      .filter(Boolean);

    const initials = firstTokens.map((token) => token[0]).join('').toUpperCase();
    const firstInitial = firstTokens[0]?.[0]?.toUpperCase() ?? '';
    const hasMultiInitial = initials.length > 1;

    const candidates = [
      fullName,
      `${parts.lastName} ${parts.firstName}`,
      normalizedLast && initials ? `${normalizedLast} ${initials}[Author]` : '',
      normalizedLast && firstInitial && !hasMultiInitial
        ? `${normalizedLast} ${firstInitial}[Author]`
        : '',
    ]
      .map((x) => x.trim())
      .filter(Boolean);

    return [...new Set(candidates)];
  }

  private scorePubmedArticleAuthorMatch(
    rawQuery: string,
    parts: { firstName: string; lastName: string },
    authorsText: string,
  ) {
    const normalizedAuthors = this.normalizeForSearch(authorsText);
    if (!normalizedAuthors) {
      return 0;
    }

    const queryTokens = this.normalizeForSearch(rawQuery).split(' ').filter(Boolean);
    const lastName = this.normalizeForSearch(parts.lastName).split(' ')[0] ?? '';
    const firstTokens = this.normalizeForSearch(parts.firstName)
      .split(' ')
      .filter(Boolean);
    const initials = firstTokens.map((token) => token[0]).join('').toLowerCase();
    const firstInitial = firstTokens[0]?.[0]?.toLowerCase() ?? '';
    const hasMultiInitial = initials.length > 1;
    const escapedLastName = this.escapeRegex(lastName);
    const escapedInitials = this.escapeRegex(initials);
    const escapedFirstInitial = this.escapeRegex(firstInitial);

    if (!lastName) {
      return 0;
    }

    const hasLastName = new RegExp(`\\b${escapedLastName}\\b`, 'i').test(
      normalizedAuthors,
    );
    if (!hasLastName) {
      return 0;
    }

    const hasFullInitialMatch =
      hasMultiInitial && escapedInitials
        ? new RegExp(`\\b${escapedLastName}\\s+${escapedInitials}\\b`, 'i').test(
            normalizedAuthors,
          )
        : false;
    const hasFirstInitialMatch = escapedFirstInitial
      ? new RegExp(`\\b${escapedLastName}\\s+${escapedFirstInitial}\\b`, 'i').test(
          normalizedAuthors,
        )
      : false;

    if (hasMultiInitial && !hasFullInitialMatch) {
      // Query has multi-initial author (e.g., YK). Prevent broad Y-only matches.
      return 0;
    }

    let score = 4;
    if (hasFullInitialMatch) {
      score += 8;
    } else if (hasFirstInitialMatch) {
      score += 4;
    }

    const tokenHits = queryTokens.filter((token) => normalizedAuthors.includes(token));
    score += Math.min(tokenHits.length, 4);

    return score;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async enrichPubmedMatchedArticles<
    T extends {
      pmid: string | null;
      articleUrl: string | null;
      score: number;
      matchedBy: string[];
    },
  >(articles: T[]) {
    if (this.pubmedMaxDetailFetches <= 0) {
      return articles;
    }

    let detailFetches = 0;
    const detailCandidates = articles
      .filter((article) => this.shouldFetchPubmedDetail(article))
      .sort(
        (a, b) =>
          (b.matchedBy?.length ?? 0) - (a.matchedBy?.length ?? 0) ||
          b.score - a.score,
      );

    for (const article of detailCandidates) {
      if (!this.shouldFetchPubmedDetail(article) || detailFetches >= this.pubmedMaxDetailFetches) {
        continue;
      }

      const detailUrl = article.articleUrl || this.buildPubmedDetailUrl(article.pmid);
      if (!detailUrl) {
        continue;
      }

      try {
        const detail = await this.fetchPubmedArticleDetail(detailUrl);
        (article as T & { detail?: PubmedArticleDetail | null }).detail = detail;
        detailFetches += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Bilinmeyen PubMed detail hatasi';
        this.logger.warn(
          `PubMed detail fetch skipped url="${detailUrl}" reason="${message}"`,
        );
      }
    }

    return articles;
  }

  private shouldFetchPubmedDetail(article: {
    pmid: string | null;
    articleUrl: string | null;
    score: number;
    matchedBy: string[];
  }) {
    if (!article.pmid && !article.articleUrl) {
      return false;
    }

    return (
      article.score >= this.pubmedDetailMinScore ||
      (article.matchedBy?.length ?? 0) > 1
    );
  }

  private buildPubmedDetailUrl(pmid?: string | null) {
    if (!pmid?.trim()) {
      return null;
    }
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid.trim()}/`;
  }

  private async fetchPubmedArticleDetail(url: string) {
    this.logger.log(`fetchPubmedArticleDetail started for target="${url}"`);
    const fetched = await this.fetchHtmlViaScraperApi(url);
    const parsed = this.parsePubmedArticleDetailHtml(fetched.body, url);
    this.logger.log(`fetchPubmedArticleDetail completed for target="${url}"`);
    return parsed;
  }

  private parsePubmedArticleDetailHtml(html: string, url: string): PubmedArticleDetail {
    const detailUrl =
      this.extractFirstMatch(
        html,
        /<link rel="canonical" href="([^"]+)"/i,
      ) ?? url;
    const pmid =
      this.extractFirstMatch(
        html,
        /<meta[^>]*name="citation_pmid"[^>]*content="([^"]+)"/i,
      ) ??
      this.extractFirstMatch(detailUrl, /\/(\d+)\/?$/);
    const journal = this.extractFirstMatch(
      html,
      /<meta[^>]*name="citation_journal_title"[^>]*content="([^"]+)"/i,
    );
    const citationDate = this.extractFirstMatch(
      html,
      /<meta[^>]*name="citation_date"[^>]*content="([^"]+)"/i,
    );
    const doi = this.extractFirstMatch(
      html,
      /<meta[^>]*name="citation_doi"[^>]*content="([^"]+)"/i,
    );
    const volume = this.extractFirstMatch(
      html,
      /<meta[^>]*name="citation_volume"[^>]*content="([^"]+)"/i,
    );
    const issue = this.extractFirstMatch(
      html,
      /<meta[^>]*name="citation_issue"[^>]*content="([^"]+)"/i,
    );
    const abstractBlock = html.match(
      /<div class="abstract" id="abstract">[\s\S]*?<div class="abstract-content selected"[\s\S]*?>([\s\S]*?)<\/div>[\s\S]*?<\/div>/i,
    );
    const abstract = abstractBlock?.[1]
      ? this.normalizeText(
          this.decodeHtmlEntities(this.stripTags(abstractBlock[1])),
        )
      : undefined;

    const authorDetails = this.extractPubmedDetailAuthors(html);

    return {
      detailUrl,
      pmid: pmid ?? undefined,
      journal: journal ?? undefined,
      citationDate: citationDate ?? undefined,
      doi: doi ?? undefined,
      volume: volume ?? undefined,
      issue: issue ?? undefined,
      abstract: abstract || undefined,
      fullAuthors: authorDetails.map((item) => item.fullName),
      authorDetails,
      fetchedAt: new Date().toISOString(),
    };
  }

  private extractPubmedDetailAuthors(html: string) {
    const section =
      html.split('<div class="authors-list">')[1]?.split('</div>')[0] ?? '';
    if (!section) {
      return [] as PubmedDetailAuthor[];
    }

    const byKey = new Map<string, PubmedDetailAuthor>();
    const itemRegex =
      /<a class="full-name"[\s\S]*?data-ga-label="([^"]+)"[\s\S]*?<\/a>([\s\S]*?)(?=<span class="authors-list-item|$)/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(section)) !== null) {
      const fullName = this.decodeHtmlEntities(
        this.normalizeText(this.stripTags(itemMatch[1] ?? '')),
      );
      if (!fullName) {
        continue;
      }

      const tail = itemMatch[2] ?? '';
      const affiliations: string[] = [];
      const affiliationRegex = /<a class="affiliation-link"[^>]*title="([^"]+)"/gi;
      let affiliationMatch: RegExpExecArray | null;
      while ((affiliationMatch = affiliationRegex.exec(tail)) !== null) {
        const rawAffiliation = this.decodeHtmlEntities(
          this.normalizeText(this.stripTags(affiliationMatch[1] ?? '')),
        );
        if (rawAffiliation && !affiliations.includes(rawAffiliation)) {
          affiliations.push(rawAffiliation);
        }
      }

      const key = this.normalizeForSearch(fullName);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          fullName,
          normalizedName: key,
          affiliations,
        });
        continue;
      }

      existing.affiliations = [...new Set([...existing.affiliations, ...affiliations])];
    }

    return Array.from(byKey.values());
  }

  private toAbsolutePubmedUrl(pathOrUrl: string) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    if (pathOrUrl.startsWith('/')) {
      return `https://pubmed.ncbi.nlm.nih.gov${pathOrUrl}`;
    }

    return `https://pubmed.ncbi.nlm.nih.gov/${pathOrUrl}`;
  }
}
