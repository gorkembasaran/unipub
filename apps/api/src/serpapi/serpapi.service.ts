import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { normalizePersonName } from '../common/normalize-person-name';

type ScholarAuthorListItem = {
  author_id: string;
  name: string | null;
  affiliation: string | null;
  email: string | null;
  interests: string[];
  cited_by: number | null;
  thumbnail: string | null;
};

type RankedScholarAuthor = ScholarAuthorListItem & {
  score: number;
  matchedTokens: string[];
  normalizedName: string;
};

type NormalizedScholarPublication = {
  title: string | null;
  publication: string | null;
  year: number | null;
  citationId: string | null;
  citedBy: number | null;
  authors: string | null;
  serpapiLink: string | null;
};

type NormalizedScholarCitationResource = {
  title: string | null;
  link: string | null;
  fileFormat: string | null;
};

type NormalizedScholarCitationDetail = {
  title: string | null;
  link: string | null;
  authors: string | null;
  publicationDate: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  description: string | null;
  resources: NormalizedScholarCitationResource[];
};

@Injectable()
export class SerpapiService {
  private readonly logger = new Logger(SerpapiService.name);
  private readonly primaryApiKey = process.env.SERPAPI_KEY ?? '';
  private readonly secondaryApiKey = process.env.SERPAPI_KEY_2 ?? '';
  private readonly activeApiKeySlot = process.env.SERPAPI_ACTIVE_KEY ?? '1';
  private readonly apiKey = this.resolveApiKey();
  private readonly baseUrl = 'https://serpapi.com/search.json';
  private readonly accountUrl = 'https://serpapi.com/account.json';
  private readonly staticAuthorId =
    process.env.SERPAPI_TEST_AUTHOR_ID ?? 'K3LR8mUAAAAJ';
  private readonly timeoutMs = this.parsePositiveInt(
    process.env.SERPAPI_TIMEOUT_MS,
    15000,
  );
  private readonly cacheTtlMs = this.parsePositiveInt(
    process.env.SERPAPI_CACHE_TTL_MS,
    60 * 60 * 1000,
  );
  private readonly responseCache = new Map<
    string,
    {
      expiresAt: number;
      value: Record<string, unknown>;
    }
  >();

  private resolveApiKey() {
    if (this.activeApiKeySlot === '2') {
      return this.secondaryApiKey || this.primaryApiKey;
    }

    return this.primaryApiKey || this.secondaryApiKey;
  }

  async searchAuthorsByName(params: {
    q: string;
    hl?: string;
    num?: number;
    start?: number;
  }) {
    this.logger.log(`searchAuthorsByName started for query="${params.q}"`);
    const query = `site:scholar.google.com/citations "${params.q}"`;
    const json = await this.request({
      engine: 'google',
      q: query,
      hl: params.hl ?? 'en',
      num: String(params.num ?? 20),
      start: String(params.start ?? 0),
    });

    const organicResults = this.readArray(json, ['organic_results']);
    const authors: ScholarAuthorListItem[] = organicResults
      .map((item) => this.mapGoogleOrganicToAuthor(item))
      .filter((item): item is ScholarAuthorListItem => item !== null);

    this.logger.log(
      `searchAuthorsByName completed with ${authors.length} authors for query="${params.q}"`,
    );
    return {
      source: 'SerpAPI',
      engine: 'google',
      query: params.q,
      total: authors.length,
      authors,
      rawSearchMetadata: this.readObject(json, ['search_metadata', 'search_information']),
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchAuthorsNormalized(params: {
    q: string;
    hl?: string;
    start?: number;
    limit?: number;
  }) {
    const limit = params.limit ?? 10;
    const normalizedQuery = this.normalizeName(params.q);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    this.logger.log(
      `searchAuthorsNormalized started query="${params.q}" normalized="${normalizedQuery}" tokens=${queryTokens.join('|')}`,
    );

    // Fetch a broader pool first, then rank locally.
    const raw = await this.searchAuthorsByName({
      q: params.q,
      hl: params.hl,
      num: 40,
      start: params.start ?? 0,
    });

    const authors = (raw.authors ?? []) as ScholarAuthorListItem[];
    const ranked = authors
      .map((author) => this.rankAuthorMatch(author, queryTokens))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    this.logger.log(
      `searchAuthorsNormalized completed raw=${authors.length} ranked=${ranked.length} top="${ranked[0]?.name ?? ''}"`,
    );

    return {
      source: 'SerpAPI',
      engine: 'google',
      query: params.q,
      normalizedQuery,
      limit,
      totalRaw: authors.length,
      totalRanked: ranked.length,
      authors: ranked,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchStaticYilmazKemalYuce() {
    this.logger.log('searchStaticYilmazKemalYuce started');
    const result = await this.searchAuthorsNormalized({
      q: 'Yılmaz Kemal Yüce',
      hl: 'tr',
      limit: 10,
    });
    this.logger.log('searchStaticYilmazKemalYuce completed');
    return result;
  }

  async getAuthorDetail(params: {
    authorId: string;
    hl?: string;
    viewOp?: string;
    sort?: string;
    citationId?: string;
    start?: number;
    num?: number;
  }) {
    this.logger.log(`getAuthorDetail started for authorId="${params.authorId}"`);
    const query: Record<string, string> = {
      engine: 'google_scholar_author',
      author_id: params.authorId,
      hl: params.hl ?? 'en',
    };

    if (params.viewOp) {
      query.view_op = params.viewOp;
    }
    if (params.sort) {
      query.sort = params.sort;
    }
    if (params.citationId) {
      query.citation_id = params.citationId;
    }
    if (params.start !== undefined) {
      query.start = String(params.start);
    }
    if (params.num !== undefined) {
      query.num = String(params.num);
    }

    const json = await this.request(query);
    const author = this.readObject(json, ['author', 'author_info']);
    const articles = this.readArray(json, ['articles', 'publications']);
    const coAuthors = this.readArray(json, ['co_authors', 'coauthors']);
    const citation = this.readObject(json, ['citation']);
    const pagination = this.readObject(json, ['serpapi_pagination']);

    this.logger.log(`getAuthorDetail completed for authorId="${params.authorId}"`);
    return {
      source: 'SerpAPI',
      engine: 'google_scholar_author',
      authorId: params.authorId,
      author,
      articles,
      coAuthors,
      citation,
      pagination,
      rawSearchMetadata: this.readObject(json, ['search_metadata', 'search_information']),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getAuthorPublications(params: {
    authorId: string;
    hl?: string;
    sort?: 'title' | 'pubdate';
    limit?: number;
  }) {
    const limit = params.limit ?? 20;
    this.logger.log(
      `getAuthorPublications started authorId="${params.authorId}" sort="${params.sort ?? 'default'}" limit=${limit}`,
    );

    const normalized: NormalizedScholarPublication[] = [];
    let start = 0;
    let pagesFetched = 0;

    while (normalized.length < limit) {
      const remaining = limit - normalized.length;
      const detail = await this.getAuthorDetail({
        authorId: params.authorId,
        hl: params.hl,
        sort: params.sort,
        start,
        num: Math.min(remaining, 100),
      });

      const articlesRaw = (detail.articles ?? []) as Array<Record<string, unknown>>;
      const pagePublications = articlesRaw
        .map((article) => this.normalizeScholarPublication(article))
        .slice(0, remaining);
      normalized.push(...pagePublications);
      pagesFetched += 1;

      const nextStart = this.extractScholarAuthorNextStart(detail.pagination);
      if (
        articlesRaw.length === 0 ||
        nextStart === null ||
        nextStart <= start
      ) {
        break;
      }

      start = nextStart;
    }

    this.logger.log(
      `getAuthorPublications completed authorId="${params.authorId}" normalized=${normalized.length} pages=${pagesFetched}`,
    );

    return {
      source: 'SerpAPI',
      authorId: params.authorId,
      total: normalized.length,
      publications: normalized,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getAuthorPublicationDetail(params: {
    authorId: string;
    citationId: string;
    hl?: string;
  }) {
    this.logger.log(
      `getAuthorPublicationDetail started authorId="${params.authorId}" citationId="${params.citationId}"`,
    );

    const detail = await this.getAuthorDetail({
      authorId: params.authorId,
      hl: params.hl,
      viewOp: 'view_citation',
      citationId: params.citationId,
    });

    const normalized = this.normalizeScholarCitationDetail(
      (detail.citation ?? {}) as Record<string, unknown>,
    );

    this.logger.log(
      `getAuthorPublicationDetail completed authorId="${params.authorId}" citationId="${params.citationId}"`,
    );

    return {
      source: 'SerpAPI',
      engine: 'google_scholar_author',
      authorId: params.authorId,
      citationId: params.citationId,
      citation: normalized,
      rawSearchMetadata: detail.rawSearchMetadata,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getStaticAuthorPublications() {
    this.logger.log(
      `getStaticAuthorPublications started staticAuthorId="${this.staticAuthorId}"`,
    );
    const result = await this.getAuthorPublications({
      authorId: this.staticAuthorId,
      hl: 'tr',
      sort: 'pubdate',
      limit: 20,
    });
    this.logger.log('getStaticAuthorPublications completed');
    return result;
  }

  async getAccountStatus() {
    this.assertApiKeyConfigured();
    const json = await this.fetchJson(
      this.buildUrl(this.accountUrl, {
        api_key: this.apiKey,
      }),
      {
        cacheKey: 'account-status',
        cacheTtlMs: Math.min(this.cacheTtlMs, 60 * 1000),
      },
    );

    return {
      source: 'SerpAPI',
      accountId: this.readString(json, ['account_id']),
      accountEmail: this.readString(json, ['account_email']),
      planId: this.readString(json, ['plan_id']),
      planName: this.readString(json, ['plan_name']),
      searchesPerMonth: this.readNumber(json, ['searches_per_month']),
      planSearchesLeft: this.readNumber(json, ['plan_searches_left']),
      extraCredits: this.readNumber(json, ['extra_credits']),
      totalSearchesLeft: this.readNumber(json, ['total_searches_left']),
      thisMonthUsage: this.readNumber(json, ['this_month_usage']),
      lastHourSearches: this.readNumber(json, ['last_hour_searches']),
      accountRateLimitPerHour: this.readNumber(json, [
        'account_rate_limit_per_hour',
      ]),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async request(params: Record<string, string>) {
    this.assertApiKeyConfigured();

    const requestParams = {
      ...params,
      api_key: this.apiKey,
      output: 'json',
    };
    const url = this.buildUrl(this.baseUrl, requestParams);
    const cacheKey = this.buildCacheKey(params);

    return this.fetchJson(url, {
      cacheKey,
      cacheTtlMs: this.cacheTtlMs,
      logLabel: `engine="${params.engine ?? 'unknown'}"`,
    });
  }

  private mapProfile(item: Record<string, unknown> | null): ScholarAuthorListItem | null {
    if (!item) {
      return null;
    }

    const authorId =
      this.readString(item, ['author_id', 'authorId', 'id']) ?? '';
    if (!authorId) {
      return null;
    }

    const interestsValue = item.interests;
    const interests = Array.isArray(interestsValue)
      ? interestsValue.filter(
          (value): value is string => typeof value === 'string' && !!value.trim(),
        )
      : [];

    const citedBy = this.readNumber(item, [
      'cited_by',
      'citedBy',
      'cited_by.value',
    ]);

    return {
      author_id: authorId,
      name: this.readString(item, ['name']),
      affiliation: this.readString(item, ['affiliations', 'affiliation']),
      email: this.readString(item, ['email', 'email_domain']),
      interests,
      cited_by: citedBy,
      thumbnail: this.readString(item, ['thumbnail']),
    };
  }

  private mapGoogleOrganicToAuthor(
    item: Record<string, unknown> | null,
  ): ScholarAuthorListItem | null {
    if (!item) {
      return null;
    }

    const link = this.readString(item, ['link']) ?? '';
    if (!link.includes('scholar.google.com/citations')) {
      return null;
    }

    const authorId = this.extractAuthorIdFromScholarUrl(link);
    if (!authorId) {
      return null;
    }

    const rawTitle = this.readString(item, ['title']) ?? '';
    const name = this.sanitizeScholarAuthorTitle(rawTitle);
    const snippet = this.sanitizeScholarAuthorSnippet(
      this.readString(item, ['snippet']),
    );
    const citedBy = this.extractCitedBy(snippet ?? '');

    return {
      author_id: authorId,
      name: name || null,
      affiliation: snippet ?? null,
      email: null,
      interests: [],
      cited_by: citedBy,
      thumbnail: null,
    };
  }

  private sanitizeScholarAuthorTitle(rawTitle: string) {
    return rawTitle
      .replace(
        /\s*[-|]\s*Google\s+(Scholar|Akademik)(\s+Citations?)?\s*$/i,
        '',
      )
      .replace(/\s*[-|]\s*Scholar\s+Profiles?\s*$/i, '')
      .trim();
  }

  private sanitizeScholarAuthorSnippet(snippet?: string | null) {
    const value = snippet?.trim();
    if (!value) {
      return null;
    }

    return value
      .replace(/\s+/g, ' ')
      .replace(/\b(g[oö]r[üu]nt[üu]le.*)$/i, '')
      .replace(/\.{3,}$/g, '')
      .trim();
  }

  private readObject(source: unknown, keys: string[]) {
    if (!source || typeof source !== 'object') {
      return null;
    }
    const obj = source as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return null;
  }

  private readArray(source: unknown, keys: string[]) {
    if (!source || typeof source !== 'object') {
      return [] as Record<string, unknown>[];
    }
    const obj = source as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === 'object' && entry !== null,
        );
      }
    }
    return [] as Record<string, unknown>[];
  }

  private readString(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = this.deepRead(source, key);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private readNumber(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = this.deepRead(source, key);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value.replace(/,/g, '').trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        const candidate = nested.value;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  private deepRead(source: Record<string, unknown>, path: string) {
    if (!path.includes('.')) {
      return source[path];
    }

    const segments = path.split('.');
    let current: unknown = source;
    for (const segment of segments) {
      if (!current || typeof current !== 'object') {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private extractAuthorIdFromScholarUrl(url: string) {
    const match = url.match(/[?&]user=([^&]+)/i);
    return match?.[1] ?? null;
  }

  private extractCitedBy(snippet: string) {
    const match = snippet.match(/cited by\s+(\d[\d,]*)/i);
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeName(value: string) {
    return normalizePersonName(value);
  }

  private rankAuthorMatch(
    author: ScholarAuthorListItem,
    queryTokens: string[],
  ): RankedScholarAuthor {
    const name = author.name ?? '';
    const normalizedName = this.normalizeName(name);
    const authorTokens = normalizedName.split(' ').filter(Boolean);

    let score = 0;
    const matchedTokens: string[] = [];

    for (const token of queryTokens) {
      if (authorTokens.includes(token)) {
        score += 3;
        matchedTokens.push(token);
        continue;
      }

      if (authorTokens.some((authorToken) => authorToken.startsWith(token))) {
        score += 2;
        matchedTokens.push(token);
        continue;
      }

      if (authorTokens.some((authorToken) => token.startsWith(authorToken))) {
        score += 1;
        matchedTokens.push(token);
      }
    }

    // Bonus for exact normalized full-name hit.
    if (normalizedName === queryTokens.join(' ')) {
      score += 4;
    }

    // Citation count as a small tie-breaker only.
    if (author.cited_by && author.cited_by > 0) {
      score += Math.min(2, Math.log10(author.cited_by + 1));
    }

    return {
      ...author,
      score: Number(score.toFixed(2)),
      matchedTokens,
      normalizedName,
    };
  }

  private normalizeScholarPublication(
    article: Record<string, unknown>,
  ): NormalizedScholarPublication {
    const title = this.readString(article, ['title']);
    const publication = this.readString(article, ['publication']);
    const year = this.readNumber(article, ['year']);
    const citationId = this.readString(article, ['citation_id', 'citationId']);
    const citedBy = this.readNumber(article, ['cited_by', 'citedBy']);
    const authors = this.readString(article, ['authors']);
    const serpapiLink = this.readString(article, ['link', 'serpapi_link']);

    return {
      title,
      publication,
      year,
      citationId,
      citedBy,
      authors,
      serpapiLink,
    };
  }

  private normalizeScholarCitationDetail(
    citation: Record<string, unknown>,
  ): NormalizedScholarCitationDetail {
    const resources = this.readArray(citation, ['resources'])
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const resource = item as Record<string, unknown>;
        return {
          title: this.readString(resource, ['title']),
          link: this.readString(resource, ['link']),
          fileFormat: this.readString(resource, ['file_format', 'fileFormat']),
        };
      })
      .filter(
        (item): item is NormalizedScholarCitationResource => item !== null,
      );

    return {
      title: this.readString(citation, ['title']),
      link: this.readString(citation, ['link']),
      authors: this.readString(citation, ['authors']),
      publicationDate: this.readString(citation, [
        'publication_date',
        'publicationDate',
      ]),
      journal: this.readString(citation, ['journal']),
      volume: this.readString(citation, ['volume']),
      issue: this.readString(citation, ['issue']),
      pages: this.readString(citation, ['pages']),
      publisher: this.readString(citation, ['publisher']),
      description: this.readString(citation, ['description', 'snippet']),
      resources,
    };
  }

  private extractScholarAuthorNextStart(
    pagination: Record<string, unknown> | null,
  ) {
    if (!pagination) {
      return null;
    }

    const nextUrl =
      this.readString(pagination, ['next', 'next_link', 'nextLink']) ?? '';
    if (!nextUrl) {
      return null;
    }

    try {
      const url = new URL(nextUrl, this.baseUrl);
      const rawStart =
        url.searchParams.get('start') ?? url.searchParams.get('cstart');
      if (!rawStart) {
        return null;
      }

      const parsed = Number(rawStart);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch {
      return null;
    }
  }

  private assertApiKeyConfigured() {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'Aktif SerpAPI anahtari tanimli degil. .env icine SERPAPI_KEY veya SERPAPI_KEY_2 ekleyin.',
      );
    }
  }

  private buildUrl(baseUrl: string, params: Record<string, string>) {
    return `${baseUrl}?${new URLSearchParams(params).toString()}`;
  }

  private buildCacheKey(params: Record<string, string>) {
    const sortedEntries = Object.entries({
      ...params,
      output: 'json',
    }).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(sortedEntries);
  }

  private getCachedValue(cacheKey: string) {
    const cached = this.responseCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      this.responseCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  private setCachedValue(
    cacheKey: string,
    value: Record<string, unknown>,
    cacheTtlMs: number,
  ) {
    if (cacheTtlMs <= 0) {
      return;
    }
    this.responseCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      value,
    });
  }

  private async fetchJson(
    url: string,
    options?: {
      cacheKey?: string;
      cacheTtlMs?: number;
      logLabel?: string;
    },
  ) {
    const cacheKey = options?.cacheKey;
    const cacheTtlMs = options?.cacheTtlMs ?? 0;
    if (cacheKey) {
      const cached = this.getCachedValue(cacheKey);
      if (cached) {
        this.logger.log(
          `SerpAPI cache hit${options?.logLabel ? ` ${options.logLabel}` : ''}`,
        );
        return cached;
      }
    }

    this.logger.log(
      `SerpAPI request ->${options?.logLabel ? ` ${options.logLabel}` : ''} url="${this.redactSensitiveQueryParams(url)}"`,
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Bilinmeyen baglanti hatasi';
      throw new BadGatewayException(`SerpAPI baglantisi basarisiz: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorPayload = await this.readErrorPayload(response);
      const errorMessage = errorPayload.message || response.statusText;
      this.logger.warn(
        `SerpAPI request failed: ${response.status} ${response.statusText} ${errorMessage}`,
      );

      if (response.status === 429) {
        throw new BadGatewayException(
          `SerpAPI kotasi veya saatlik throughput limiti dolu: ${errorMessage}`,
        );
      }

      throw new BadGatewayException(
        `SerpAPI hatasi: ${response.status} ${response.statusText} ${errorMessage}`,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    if (cacheKey) {
      this.setCachedValue(cacheKey, json, cacheTtlMs);
    }

    this.logger.log(
      `SerpAPI request completed${options?.logLabel ? ` ${options.logLabel}` : ''} status=${response.status}`,
    );
    return json;
  }

  private async readErrorPayload(response: Response) {
    const bodyText = await response.text();
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      const message =
        (typeof parsed.error === 'string' && parsed.error.trim()) ||
        (typeof parsed.message === 'string' && parsed.message.trim()) ||
        bodyText;
      return {
        message: message.slice(0, 300),
      };
    } catch {
      return {
        message: bodyText.slice(0, 300),
      };
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    if (!value?.trim()) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
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
}
