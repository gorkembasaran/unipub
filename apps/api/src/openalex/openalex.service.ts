import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

// OpenAlex (https://openalex.org) is a free, CC0-licensed scholarly catalog.
// Unlike WoS / Scopus / Google Scholar its data may be shown and redistributed
// publicly, so it is the default source for the hosted demo.

type OpenalexInstitution = {
  id?: string;
  display_name?: string;
  country_code?: string | null;
};

type OpenalexAuthor = {
  id?: string;
  orcid?: string | null;
  display_name?: string;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: { h_index?: number } | null;
  last_known_institutions?: OpenalexInstitution[] | null;
};

type OpenalexWork = {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  type?: string | null;
  cited_by_count?: number;
  open_access?: { is_oa?: boolean } | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: { display_name?: string | null } | null;
  } | null;
  authorships?: Array<{ author?: { id?: string; display_name?: string } }>;
};

type OpenalexListResponse<T> = {
  meta?: { count?: number; next_cursor?: string | null };
  results?: T[];
};

const AUTHOR_FIELDS = [
  'id',
  'orcid',
  'display_name',
  'works_count',
  'cited_by_count',
  'summary_stats',
  'last_known_institutions',
].join(',');

const WORK_FIELDS = [
  'id',
  'doi',
  'display_name',
  'publication_year',
  'type',
  'cited_by_count',
  'open_access',
  'primary_location',
  'authorships',
].join(',');

@Injectable()
export class OpenalexService {
  private readonly logger = new Logger(OpenalexService.name);
  private readonly baseUrl =
    process.env.OPENALEX_API_BASE_URL ?? 'https://api.openalex.org';
  // Contact email puts requests in OpenAlex's "polite pool".
  private readonly mailto = process.env.OPENALEX_MAILTO?.trim() ?? '';
  private readonly apiKey = process.env.OPENALEX_API_KEY?.trim() ?? '';
  private readonly timeoutMs = this.parsePositiveInt(
    process.env.OPENALEX_TIMEOUT_MS,
    15000,
  );
  private readonly pageSize = 200;

  async searchAuthors(options: {
    q: string;
    institutionId?: string;
    limit?: number;
  }) {
    const limit = options.limit ?? 10;
    const params = new URLSearchParams({
      search: options.q,
      'per-page': String(Math.min(limit, this.pageSize)),
      select: AUTHOR_FIELDS,
    });
    if (options.institutionId) {
      params.set(
        'filter',
        `last_known_institutions.id:${this.normalizeId(options.institutionId, 'I')}`,
      );
    }

    const json = await this.request<OpenalexListResponse<OpenalexAuthor>>(
      '/authors',
      params,
    );
    const authors = (json.results ?? []).map((author) =>
      this.normalizeAuthor(author),
    );

    return {
      source: 'OpenAlex',
      query: options.q,
      fetchedAt: new Date().toISOString(),
      total: json.meta?.count ?? authors.length,
      authors,
    };
  }

  async getAuthor(id: string) {
    const authorId = this.normalizeId(id, 'A');
    const params = new URLSearchParams({ select: AUTHOR_FIELDS });
    const author = await this.request<OpenalexAuthor>(
      `/authors/${authorId}`,
      params,
    );
    return { source: 'OpenAlex', author: this.normalizeAuthor(author) };
  }

  async getAuthorWorks(id: string, options?: { limit?: number }) {
    const authorId = this.normalizeId(id, 'A');
    const limit = options?.limit ?? 200;
    const works: ReturnType<OpenalexService['normalizeWork']>[] = [];
    let cursor: string | null = '*';
    let total = 0;

    this.logger.log(`getAuthorWorks started authorId="${authorId}" limit=${limit}`);

    while (cursor && works.length < limit) {
      const params = new URLSearchParams({
        filter: `author.id:${authorId}`,
        sort: 'publication_year:desc',
        'per-page': String(Math.min(this.pageSize, limit - works.length)),
        cursor,
        select: WORK_FIELDS,
      });
      const json = await this.request<OpenalexListResponse<OpenalexWork>>(
        '/works',
        params,
      );
      const results = json.results ?? [];
      total = json.meta?.count ?? total;
      works.push(...results.map((work) => this.normalizeWork(work)));
      cursor = results.length > 0 ? (json.meta?.next_cursor ?? null) : null;
    }

    this.logger.log(
      `getAuthorWorks completed authorId="${authorId}" fetched=${works.length} total=${total}`,
    );

    return {
      source: 'OpenAlex',
      authorId,
      fetchedAt: new Date().toISOString(),
      total,
      works: works.slice(0, limit),
    };
  }

  private normalizeAuthor(author: OpenalexAuthor) {
    const externalId = this.stripOpenalexPrefix(author.id);
    return {
      externalId,
      displayName: author.display_name ?? '',
      orcid: this.stripOrcidPrefix(author.orcid),
      worksCount: author.works_count ?? 0,
      citedByCount: author.cited_by_count ?? 0,
      hIndex: author.summary_stats?.h_index ?? null,
      institutions: (author.last_known_institutions ?? []).map((institution) => ({
        id: this.stripOpenalexPrefix(institution.id),
        name: institution.display_name ?? '',
        countryCode: institution.country_code ?? null,
      })),
      profileUrl: externalId ? `https://openalex.org/${externalId}` : null,
    };
  }

  private normalizeWork(work: OpenalexWork) {
    return {
      externalId: this.stripOpenalexPrefix(work.id),
      title: work.display_name ?? '',
      doi: work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, '') : null,
      publishedYear: work.publication_year ?? null,
      journal: work.primary_location?.source?.display_name ?? null,
      type: work.type ?? null,
      citedByCount: work.cited_by_count ?? 0,
      isOpenAccess: work.open_access?.is_oa ?? false,
      authors: (work.authorships ?? [])
        .map((authorship) => authorship.author?.display_name)
        .filter((name): name is string => Boolean(name)),
      url: work.doi ?? work.primary_location?.landing_page_url ?? work.id ?? null,
    };
  }

  // Accepts "A123", "a123" or "https://openalex.org/A123".
  private normalizeId(value: string, prefix: 'A' | 'I') {
    const id = this.stripOpenalexPrefix(value?.trim()).toUpperCase();
    if (!new RegExp(`^${prefix}\\d+$`).test(id)) {
      throw new BadRequestException(
        `Gecersiz OpenAlex id: "${value}". Ornek: ${prefix}5016678671`,
      );
    }
    return id;
  }

  private stripOpenalexPrefix(value?: string | null) {
    return (value ?? '').replace(/^https?:\/\/openalex\.org\//i, '');
  }

  private stripOrcidPrefix(value?: string | null) {
    return value ? value.replace(/^https?:\/\/orcid\.org\//i, '') : null;
  }

  private async request<T>(path: string, params: URLSearchParams): Promise<T> {
    if (this.mailto) {
      params.set('mailto', this.mailto);
    }
    if (this.apiKey) {
      params.set('api_key', this.apiKey);
    }

    const url = `${this.baseUrl}${path}?${params.toString()}`;
    this.logger.log(`OpenAlex request -> ${url.replace(/api_key=[^&]+/, 'api_key=[redacted]')}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? `OpenAlex servisine baglanilamadi: ${error.message}`
          : 'OpenAlex servisine baglanilamadi.';
      throw new BadGatewayException(message);
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      throw new NotFoundException('OpenAlex kaydi bulunamadi.');
    }
    if (!response.ok) {
      this.logger.warn(
        `OpenAlex request failed: ${response.status} ${response.statusText}`,
      );
      throw new BadGatewayException(
        `OpenAlex hatasi: ${response.status} ${response.statusText}`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException('OpenAlex yaniti parse edilemedi.');
    }
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
