import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { arePersonNamesCompatible } from '../common/person-name-match';
import { normalizePersonName } from '../common/normalize-person-name';

@Injectable()
export class TrdizinService {
  private readonly logger = new Logger(TrdizinService.name);
  private readonly baseUrl =
    process.env.TRDIZIN_API_BASE_URL ?? 'https://search.trdizin.gov.tr';
  private readonly defaultAuthor =
    process.env.TRDIZIN_TEST_AUTHOR ?? 'Aziz Sancar';
  private readonly staticTestAuthor =
    process.env.TRDIZIN_TEST_AUTHOR_SEARCH ?? 'Yılmaz Kemal Yüce';

  async searchByAuthor(author: string) {
    this.logger.log(`searchByAuthor started for query="${author}"`);
    const pageSize = 20;
    const pages = await this.fetchAllPublicationPages(author, pageSize);
    const data = pages[0] ?? null;
    const totalFetched = pages.flatMap((page) => this.extractPublications(page)).length;
    this.logger.log(
      `searchByAuthor completed for query="${author}" pages=${pages.length} publications=${totalFetched}`,
    );
    return {
      source: 'TR Dizin',
      author,
      fetchedAt: new Date().toISOString(),
      data,
      pages,
      pagesFetched: pages.length,
      totalFetched,
    };
  }

  async getStaticAuthorPublications() {
    return this.searchByAuthor(this.defaultAuthor);
  }

  async searchPublicationsByAuthorId(author: string, authorId: number) {
    this.logger.log(
      `searchPublicationsByAuthorId started for query="${author}" authorId=${authorId}`,
    );
    const pageSize = 20;
    const pages = await this.fetchAllPublicationPages(author, pageSize);
    const publications = pages.flatMap((page) => this.extractPublications(page));
    const firstPage = pages[0];

    const filtered = publications
      .filter((publication) => {
        const authors = this.readAuthors(publication);
        return authors.some(
          (entry) =>
            this.matchAuthorId(entry, authorId) &&
            this.matchAuthorName(entry, author),
        );
      })
      .map((publication) => {
        const matchedAuthor = this.readAuthors(publication).find(
          (entry) =>
            this.matchAuthorId(entry, authorId) &&
            this.matchAuthorName(entry, author),
        );

        return {
          publication,
          matchedAuthor,
        };
      });

    return {
      source: 'TR Dizin',
      authorQuery: author,
      authorId,
      totalFetched: publications.length,
      matchedCount: filtered.length,
      matchedPublications: filtered,
      rawKeys:
        firstPage && typeof firstPage === 'object'
          ? Object.keys(firstPage as Record<string, unknown>)
          : [],
      pagesFetched: pages.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchAuthorsNormalized(params: {
    q: string;
    limit?: number;
  }) {
    const query = params.q.trim();
    const limit = params.limit ?? 10;
    const normalizedQuery = this.normalizeName(query);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    this.logger.log(
      `searchAuthorsNormalized started query="${query}" normalized="${normalizedQuery}"`,
    );

    const raw = await this.searchByAuthor(query);
    const candidateSource =
      Array.isArray(raw.pages) && raw.pages.length > 0
        ? { pages: raw.pages }
        : raw.data;
    const candidates = this.extractAuthorCandidates(candidateSource);
    const ranked = candidates
      .map((candidate) => this.rankAuthorCandidate(candidate, queryTokens))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    this.logger.log(
      `searchAuthorsNormalized completed query="${query}" raw=${candidates.length} ranked=${ranked.length}`,
    );

    return {
      source: 'TR Dizin',
      query,
      normalizedQuery,
      pagesFetched:
        typeof raw.pagesFetched === 'number' ? raw.pagesFetched : undefined,
      totalRaw: candidates.length,
      totalRanked: ranked.length,
      authors: ranked,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchAuthorsStatic() {
    this.logger.log(
      `searchAuthorsStatic started staticAuthor="${this.staticTestAuthor}"`,
    );
    const result = await this.searchAuthorsNormalized({
      q: this.staticTestAuthor,
      limit: 10,
    });
    this.logger.log('searchAuthorsStatic completed');
    return result;
  }

  private extractPublications(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      );
    }

    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const obj = payload as Record<string, unknown>;
    const candidates = [
      'content',
      'data',
      'results',
      'publications',
      'items',
      'records',
      'docs',
    ];

    for (const key of candidates) {
      const value = obj[key];
      if (Array.isArray(value)) {
        const normalized = this.normalizePublicationArray(value);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    }

    // Common Elasticsearch-like format: { hits: { hits: [{ _source: {...} }] } }
    const hits = obj.hits;
    if (hits && typeof hits === 'object') {
      const nestedHits = (hits as Record<string, unknown>).hits;
      if (Array.isArray(nestedHits)) {
        const normalized = this.normalizePublicationArray(nestedHits);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    }

    // Fallback: recursively scan object tree for the first publication-like array.
    const recursive = this.findPublicationArray(obj, 0, 7);
    if (recursive.length > 0) {
      return recursive;
    }

    return [];
  }

  private readAuthors(
    publication: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    const candidateKeys = [
      'authors',
      'authorList',
      'writerList',
      'publicationAuthors',
      'contributors',
    ];

    for (const key of candidateKeys) {
      const value = publication[key];
      if (Array.isArray(value)) {
        return value.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === 'object' && entry !== null,
        );
      }
    }

    return [];
  }

  private normalizePublicationArray(items: unknown[]): Record<string, unknown>[] {
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const record = item as Record<string, unknown>;
        const source = record._source;

        if (source && typeof source === 'object' && !Array.isArray(source)) {
          return source as Record<string, unknown>;
        }

        return record;
      })
      .filter((item): item is Record<string, unknown> => item !== null);
  }

  private findPublicationArray(
    node: Record<string, unknown>,
    depth: number,
    maxDepth: number,
  ): Record<string, unknown>[] {
    if (depth > maxDepth) {
      return [];
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        const normalized = this.normalizePublicationArray(value);
        if (normalized.length > 0) {
          return normalized;
        }
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const found = this.findPublicationArray(
          value as Record<string, unknown>,
          depth + 1,
          maxDepth,
        );
        if (found.length > 0) {
          return found;
        }
      }
    }

    return [];
  }

  private matchAuthorId(
    authorEntry: Record<string, unknown>,
    authorId: number,
  ): boolean {
    const keys = ['authorId', 'id', 'personId', 'researcherId'];
    return keys.some((key) => Number(authorEntry[key]) === authorId);
  }

  private matchAuthorName(
    authorEntry: Record<string, unknown>,
    authorQuery: string,
  ) {
    const names = this.extractAuthorEntryNames(authorEntry);
    if (names.length === 0) {
      return true;
    }

    return names.some((name) =>
      arePersonNamesCompatible(authorQuery, name, {
        allowInitialSuffixMatch: true,
      }),
    );
  }

  private extractAuthorEntryNames(authorEntry: Record<string, unknown>) {
    const names = new Set<string>();
    const combinedName = [
      this.readString(authorEntry, ['firstName', 'givenName', 'name1']),
      this.readString(authorEntry, ['lastName', 'surname', 'familyName', 'name2']),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    for (const value of [
      this.readString(authorEntry, [
        'name',
        'inPublicationName',
        'fullName',
        'authorName',
      ]),
      combinedName || null,
    ]) {
      if (value?.trim()) {
        names.add(value.trim());
      }
    }

    return Array.from(names);
  }

  private extractAuthorCandidates(payload: unknown) {
    const found = this.findObjectsByKey(payload, 'authorId');
    const byId = new Map<
      string,
      {
        authorId: string;
        displayName: string;
        normalizedName: string;
        affiliations: string[];
      }
    >();

    for (const item of found) {
      const authorId = this.readString(item, ['authorId', 'id', 'personId']);
      const displayName = this.readString(item, ['name', 'inPublicationName']);
      if (!authorId || !displayName) {
        continue;
      }

      const affiliations = this.readStringArray(item, ['institutionName']);
      const normalizedName = this.normalizeName(displayName);

      const existing = byId.get(authorId);
      if (!existing) {
        byId.set(authorId, {
          authorId,
          displayName,
          normalizedName,
          affiliations,
        });
        continue;
      }

      const mergedAffiliations = [
        ...existing.affiliations,
        ...affiliations,
      ].filter(Boolean);

      byId.set(authorId, {
        ...existing,
        affiliations: [...new Set(mergedAffiliations)],
      });
    }

    return Array.from(byId.values());
  }

  private rankAuthorCandidate(
    candidate: {
      authorId: string;
      displayName: string;
      normalizedName: string;
      affiliations: string[];
    },
    queryTokens: string[],
  ) {
    const nameTokens = candidate.normalizedName.split(' ').filter(Boolean);
    let score = 0;
    const matchedTokens: string[] = [];

    for (const token of queryTokens) {
      if (nameTokens.includes(token)) {
        score += 3;
        matchedTokens.push(token);
        continue;
      }
      if (nameTokens.some((nameToken) => nameToken.startsWith(token))) {
        score += 2;
        matchedTokens.push(token);
        continue;
      }
      if (nameTokens.some((nameToken) => token.startsWith(nameToken))) {
        score += 1;
        matchedTokens.push(token);
      }
    }

    if (candidate.normalizedName === queryTokens.join(' ')) {
      score += 4;
    }

    return {
      authorId: candidate.authorId,
      displayName: candidate.displayName,
      normalizedName: candidate.normalizedName,
      affiliations: candidate.affiliations,
      score: Number(score.toFixed(2)),
      matchedTokens,
      profileUrl: `https://search.trdizin.gov.tr/tr/yayin/ara?q=${encodeURIComponent(candidate.displayName)}`,
    };
  }

  private findObjectsByKey(payload: unknown, key: string) {
    const result: Array<Record<string, unknown>> = [];

    const walk = (node: unknown) => {
      if (!node) {
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }
      if (typeof node !== 'object') {
        return;
      }

      const obj = node as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result.push(obj);
      }

      for (const value of Object.values(obj)) {
        walk(value);
      }
    };

    walk(payload);
    return result;
  }

  private readString(obj: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  private readStringArray(obj: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value
          .map((item) => (typeof item === 'string' ? item.trim() : null))
          .filter((item): item is string => !!item);
      }
    }
    return [] as string[];
  }

  private normalizeName(value: string) {
    return normalizePersonName(value);
  }

  private async requestPublicationSearch(
    query: string,
    options?: {
      page?: number;
      limit?: number;
    },
  ) {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const params = new URLSearchParams({
      q: query,
      order: 'relevance-DESC',
      page: String(page),
      limit: String(limit),
    });

    const url = `${this.baseUrl}/api/defaultSearch/publication/?${params.toString()}`;
    this.logger.log(`TR Dizin request -> ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? `TR Dizin servisine baglanilamadi: ${error.message}`
          : 'TR Dizin servisine baglanilamadi.';
      throw new BadGatewayException(message);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      this.logger.warn(
        `TR Dizin request failed: ${response.status} ${response.statusText}`,
      );
      throw new BadGatewayException(
        `TR Dizin hatasi: ${response.status} ${response.statusText}`,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new InternalServerErrorException(
        'TR Dizin yaniti parse edilemedi.',
      );
    }
  }

  private async fetchAllPublicationPages(query: string, pageSize: number) {
    const pages: unknown[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const page = await this.requestPublicationSearch(query, {
        page: currentPage,
        limit: pageSize,
      });
      pages.push(page);

      const totalHits = this.readTotalHits(page);
      if (totalHits !== null) {
        totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
      }

      const publications = this.extractPublications(page);
      if (publications.length < pageSize) {
        break;
      }

      currentPage += 1;
    }

    return pages;
  }

  private readTotalHits(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const hits = (payload as Record<string, unknown>).hits;
    if (!hits || typeof hits !== 'object') {
      return null;
    }

    const total = (hits as Record<string, unknown>).total;
    if (typeof total === 'number' && Number.isFinite(total)) {
      return total;
    }

    if (total && typeof total === 'object') {
      const value = (total as Record<string, unknown>).value;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }
}
