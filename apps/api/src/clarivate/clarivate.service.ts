import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

type WosStarterApiVersion = 'v1' | 'v2';

type WosStarterDocumentsParams = {
  q: string;
  db?: string;
  limit?: number;
  page?: number;
  sortField?: string;
  modifiedTimeSpan?: string;
  publishTimeSpan?: string;
  tcModifiedTimeSpan?: string;
  detail?: string;
  edition?: string;
  apiVersion?: WosStarterApiVersion;
};

type ClarivateAuthorMatch = {
  displayName: string;
  wosStandard?: string;
  researcherId?: string;
  affiliations: string[];
  documentCount: number;
  sampleUids: string[];
};

type ClarivateResearcherProfile = {
  displayName?: string;
  researcherId?: string;
  wosStandard?: string;
  affiliations: string[];
  raw: Record<string, unknown> | null;
};

type ClarivateSearchAuthorsParams = {
  q: string;
  db?: string;
  limit?: number;
  page?: number;
  detail?: string;
  sortField?: string;
  apiVersion?: WosStarterApiVersion;
  includeCandidates?: boolean;
  includeHits?: boolean;
  includeRaw?: boolean;
  maxPages?: number;
  preferredResearcherId?: string;
  preferredWosStandard?: string;
  preferredDisplayName?: string;
  preferredAffiliations?: string[];
  preferredUniversity?: string;
  preferredCity?: string;
  preferredCountry?: string;
};

@Injectable()
export class ClarivateService {
  private readonly affiliationNoiseTokens = new Set([
    'university',
    'universite',
    'universitesi',
    'universitesi',
    'department',
    'dept',
    'faculty',
    'school',
    'institute',
    'institution',
    'center',
    'centre',
    'college',
    'hospital',
    'engineering',
    'medicine',
    'medical',
    'health',
    'science',
    'sciences',
    'turkiye',
    'turkey',
  ]);
  private readonly logger = new Logger(ClarivateService.name);
  private readonly apiKey =
    process.env.CLARIVATE_WOS_STARTER_API_KEY ??
    process.env.CLARIVATE_API_KEY ??
    process.env.WOS_STARTER_API_KEY ??
    '';
  private readonly researcherApiKey =
    process.env.CLARIVATE_WOS_RESEARCHER_API_KEY ??
    process.env.CLARIVATE_RESEARCHER_API_KEY ??
    '';
  private readonly requestTimeoutMs = Number(
    process.env.CLARIVATE_TIMEOUT_MS ?? '15000',
  );
  private readonly baseUrls: Record<WosStarterApiVersion, string> = {
    v1: 'https://api.clarivate.com/apis/wos-starter/v1',
    v2: 'https://api.clarivate.com/apis/wos-starter/v2',
  };
  private readonly researcherBaseUrl =
    'https://api.clarivate.com/apis/wos-researcher';

  async searchDocuments(params: WosStarterDocumentsParams) {
    const apiVersion = params.apiVersion ?? 'v2';
    const query = new URLSearchParams();

    query.set('q', params.q.trim());
    query.set('db', params.db?.trim() || 'WOS');

    if (params.limit) {
      query.set('limit', String(params.limit));
    }
    if (params.page) {
      query.set('page', String(params.page));
    }
    if (params.sortField?.trim()) {
      query.set('sortField', params.sortField.trim());
    }
    if (params.modifiedTimeSpan?.trim()) {
      query.set('modifiedTimeSpan', params.modifiedTimeSpan.trim());
    }
    if (params.publishTimeSpan?.trim()) {
      query.set('publishTimeSpan', params.publishTimeSpan.trim());
    }
    if (params.tcModifiedTimeSpan?.trim()) {
      query.set('tcModifiedTimeSpan', params.tcModifiedTimeSpan.trim());
    }
    if (params.detail?.trim()) {
      query.set('detail', params.detail.trim());
    }
    if (params.edition?.trim()) {
      query.set('edition', params.edition.trim());
    }

    const url = `${this.baseUrls[apiVersion]}/documents?${query.toString()}`;
    const data = await this.request(url);

    return {
      source: 'Clarivate Web of Science Starter API',
      apiVersion,
      endpoint: '/documents',
      request: {
        ...params,
        apiVersion,
        db: params.db?.trim() || 'WOS',
      },
      metadata:
        data && typeof data === 'object' && 'metadata' in data
          ? (data as Record<string, unknown>).metadata
          : null,
      hits:
        data &&
        typeof data === 'object' &&
        Array.isArray((data as Record<string, unknown>).hits)
          ? (data as Record<string, unknown>).hits
          : [],
      raw: data,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchAuthors(params: ClarivateSearchAuthorsParams) {
    const authorQuery = params.q.trim();
    const wosQuery = this.buildAuthorQuery(authorQuery);
    const requestedLimit = this.clampDocumentsLimit(params.limit);
    const startPage = this.resolveStartPage(params.page);
    const maxPages = this.resolveMaxPages(params.maxPages, requestedLimit);
    const aggregatedHits: unknown[] = [];
    const aggregatedRaw: unknown[] = [];
    let metadata: unknown = null;
    let lastFetchedAt = new Date().toISOString();
    let currentPage = startPage;
    let pagesFetched = 0;

    while (pagesFetched < maxPages) {
      const documents = await this.searchDocuments({
        q: wosQuery,
        db: params.db,
        limit: requestedLimit,
        page: currentPage,
        detail: params.detail,
        sortField: params.sortField,
        apiVersion: params.apiVersion,
      });

      if (pagesFetched === 0) {
        metadata = documents.metadata;
      }

      const pageHits = Array.isArray(documents.hits) ? documents.hits : [];
      aggregatedHits.push(...pageHits);
      aggregatedRaw.push(documents.raw);
      lastFetchedAt = documents.fetchedAt;
      pagesFetched += 1;

      if (
        !this.shouldContinueAuthorPagination(
          documents.metadata,
          pageHits.length,
          requestedLimit,
          currentPage,
          pagesFetched,
          maxPages,
        )
      ) {
        break;
      }

      currentPage += 1;
    }

    const candidates = this.extractAuthorsFromHits(aggregatedHits);
    const selectedAuthor = this.findPreferredAuthorMatch(
      authorQuery,
      candidates,
      params,
    );
    const author = await this.enrichAuthorMatch(
      selectedAuthor,
      authorQuery,
      params,
    );
    const publications = this.extractPublicationsForAuthor(
      aggregatedHits,
      author,
      authorQuery,
    );
    const filteredPublications = this.filterPublicationsByAuthorContext(
      publications,
      author,
    );
    const affiliations = this.mergeStringArrays(
      author?.affiliations ?? [],
      this.extractAffiliationsForAuthor(aggregatedHits, author, authorQuery),
    );

    return {
      source: 'Clarivate Web of Science Starter API',
      apiVersion: params.apiVersion ?? 'v2',
      authorQuery,
      wosQuery,
      metadata,
      pagination: {
        startPage,
        requestedLimit,
        maxPages,
        pagesFetched,
        hitsFetched: aggregatedHits.length,
      },
      author,
      affiliations,
      affiliationNote:
        affiliations.length > 0
          ? undefined
          : 'Clarivate Web of Science Starter API bu cevapta affiliation/address alani vermedi.',
      publications: filteredPublications,
      ...(params.includeCandidates ? { candidates } : {}),
      ...(params.includeHits ? { hits: aggregatedHits } : {}),
      ...(params.includeRaw
        ? {
            raw:
              aggregatedRaw.length <= 1
                ? aggregatedRaw[0] ?? null
                : aggregatedRaw,
          }
        : {}),
      fetchedAt: lastFetchedAt,
    };
  }

  private async request(url: string) {
    return this.requestWithApiKey(url, this.apiKey, 'CLARIVATE_WOS_STARTER_API_KEY');
  }

  private async requestWithApiKey(
    url: string,
    apiKey: string,
    envKeyLabel: string,
  ) {
    if (!apiKey) {
      throw new InternalServerErrorException(
        `Clarivate API key eksik. .env icine ${envKeyLabel} ekleyin.`,
      );
    }

    this.logger.log(`Clarivate request -> ${url}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-ApiKey': apiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Bilinmeyen baglanti hatasi';
      throw new BadGatewayException(
        `Clarivate servisine baglanilamadi: ${message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const bodyText = await response.text();
      this.logger.warn(
        `Clarivate request failed: ${response.status} ${response.statusText}`,
      );
      throw new BadGatewayException(
        `Clarivate hatasi: ${response.status} ${response.statusText} ${bodyText.slice(0, 400)}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private buildAuthorQuery(value: string) {
    const trimmed = value.trim();
    if (/\b[A-Z]{2,3}\s*=/i.test(trimmed)) {
      return trimmed;
    }

    const normalized = this.foldSearchText(trimmed)
      .replace(/[",]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length < 2) {
      return `AU=("${this.escapeWosQueryValue(normalized)}")`;
    }

    const surname = parts[parts.length - 1];
    const givenNames = parts.slice(0, -1);
    const surnameFirst = `${surname} ${givenNames.join(' ')}`;
    const initials = givenNames
      .map((part) => part[0]?.toUpperCase())
      .filter(Boolean)
      .join('');

    const variants = [
      `AU=("${this.escapeWosQueryValue(surnameFirst)}")`,
      initials
        ? `AU=(${this.escapeWosQueryValue(`${surname} ${initials}`)})`
        : '',
    ].filter(Boolean);

    return variants.length > 1 ? `(${variants.join(' OR ')})` : variants[0];
  }

  private async enrichAuthorMatch(
    author: ClarivateAuthorMatch | null,
    authorQuery: string,
    params: ClarivateSearchAuthorsParams,
  ) {
    if (!author) {
      return null;
    }

    const promotedDisplayName = this.promoteAuthorDisplayNameFromQuery(
      author.displayName,
      author.wosStandard,
      params.preferredDisplayName ?? authorQuery,
    );
    const baseAuthor: ClarivateAuthorMatch = {
      ...author,
      displayName: promotedDisplayName ?? author.displayName,
      affiliations: [...author.affiliations],
      sampleUids: [...author.sampleUids],
    };

    const researcherId = author.researcherId?.trim();
    if (!researcherId || !this.researcherApiKey) {
      return baseAuthor;
    }

    const profile = await this.tryFetchResearcherProfile(researcherId);
    if (!profile) {
      return baseAuthor;
    }

    return {
      ...baseAuthor,
      displayName:
        profile.displayName?.trim() ||
        promotedDisplayName ||
        baseAuthor.displayName,
      researcherId: profile.researcherId?.trim() || baseAuthor.researcherId,
      wosStandard: profile.wosStandard?.trim() || baseAuthor.wosStandard,
      affiliations: this.mergeStringArrays(
        baseAuthor.affiliations,
        profile.affiliations,
      ),
    };
  }

  private async tryFetchResearcherProfile(researcherId: string) {
    try {
      const url = `${this.researcherBaseUrl}/researchers/${encodeURIComponent(
        researcherId,
      )}`;
      const data = await this.requestWithApiKey(
        url,
        this.researcherApiKey,
        'CLARIVATE_WOS_RESEARCHER_API_KEY',
      );
      return this.extractResearcherProfile(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Bilinmeyen Researcher API hatasi';
      this.logger.warn(
        `Clarivate Researcher API enrichment atlandi researcherId=${researcherId}: ${message}`,
      );
      return null;
    }
  }

  private foldSearchText(value: string) {
    return value
      .replace(/[Çç]/g, 'c')
      .replace(/[Ğğ]/g, 'g')
      .replace(/[İIı]/g, 'i')
      .replace(/[Öö]/g, 'o')
      .replace(/[Şş]/g, 's')
      .replace(/[Üü]/g, 'u')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private escapeWosQueryValue(value: string) {
    return value.replace(/"/g, '\\"').trim();
  }

  private extractAuthorsFromHits(hits: unknown) {
    if (!Array.isArray(hits)) {
      return [];
    }

    const byKey = new Map<string, ClarivateAuthorMatch>();

    for (const hit of hits) {
      if (!hit || typeof hit !== 'object') {
        continue;
      }

      const hitObject = hit as Record<string, unknown>;
      const uid =
        typeof hitObject.uid === 'string' ? hitObject.uid.trim() : undefined;
      const names =
        hitObject.names && typeof hitObject.names === 'object'
          ? (hitObject.names as Record<string, unknown>)
          : null;
      const authors = names?.authors;

      if (!Array.isArray(authors)) {
        continue;
      }

      for (const author of authors) {
        if (!author || typeof author !== 'object') {
          continue;
        }

        const authorObject = author as Record<string, unknown>;
        const authorAffiliations = this.collectPossibleAffiliations(authorObject);
        const displayName =
          typeof authorObject.displayName === 'string'
            ? authorObject.displayName.trim()
            : '';

        if (!displayName) {
          continue;
        }

        const researcherId =
          typeof authorObject.researcherId === 'string'
            ? authorObject.researcherId.trim()
            : undefined;
        const wosStandard =
          typeof authorObject.wosStandard === 'string'
            ? authorObject.wosStandard.trim()
            : undefined;
        const key = this.buildClarivateAuthorKey({
          displayName,
          researcherId,
          wosStandard,
          affiliations: authorAffiliations,
        });
        const existing = byKey.get(key);

        if (!existing) {
          byKey.set(key, {
            displayName,
            wosStandard,
            researcherId,
            affiliations: authorAffiliations,
            documentCount: 1,
            sampleUids: uid ? [uid] : [],
          });
          continue;
        }

        existing.documentCount += 1;
        if (displayName.length > existing.displayName.length) {
          existing.displayName = displayName;
        }
        if (!existing.wosStandard && wosStandard) {
          existing.wosStandard = wosStandard;
        }
        if (!existing.researcherId && researcherId) {
          existing.researcherId = researcherId;
        }
        existing.affiliations = this.mergeStringArrays(
          existing.affiliations,
          authorAffiliations,
        );
        if (
          uid &&
          !existing.sampleUids.includes(uid) &&
          existing.sampleUids.length < 5
        ) {
          existing.sampleUids.push(uid);
        }
      }
    }

    return Array.from(byKey.values()).sort(
      (left, right) =>
        right.documentCount - left.documentCount ||
        left.displayName.localeCompare(right.displayName),
    );
  }

  private findBestAuthorMatch(
    authorQuery: string,
    authors: ClarivateAuthorMatch[],
    params?: ClarivateSearchAuthorsParams,
  ) {
    if (authors.length === 0) {
      return null;
    }

    return [...authors].sort(
      (left, right) =>
        this.scoreAuthorSelection(authorQuery, right, params) -
          this.scoreAuthorSelection(authorQuery, left, params) ||
        right.documentCount - left.documentCount ||
        left.displayName.localeCompare(right.displayName),
    )[0];
  }

  private findPreferredAuthorMatch(
    authorQuery: string,
    authors: ClarivateAuthorMatch[],
    params: ClarivateSearchAuthorsParams,
  ) {
    if (authors.length === 0) {
      return null;
    }

    const preferredResearcherId = this.normalizeIdentifier(
      params.preferredResearcherId,
    );
    const preferredWosStandard = this.normalizeIdentifier(
      params.preferredWosStandard,
    );
    const preferredDisplayName = this.normalizeIdentifier(
      params.preferredDisplayName,
    );

    const preferredAuthors = authors.filter((author) => {
      if (
        preferredResearcherId &&
        this.normalizeIdentifier(author.researcherId) === preferredResearcherId
      ) {
        return true;
      }

      if (
        preferredWosStandard &&
        this.normalizeIdentifier(author.wosStandard) === preferredWosStandard
      ) {
        return true;
      }

      return (
        preferredDisplayName &&
        this.normalizeIdentifier(author.displayName) === preferredDisplayName
      );
    });

    if (preferredAuthors.length > 0) {
      const bestPreferred = this.findBestAuthorMatch(
        authorQuery,
        preferredAuthors,
        params,
      );
      if (
        bestPreferred &&
        this.isConfidentClarivateAuthorSelection(
          authorQuery,
          preferredAuthors,
          bestPreferred,
          params,
        )
      ) {
        return bestPreferred;
      }
      return null;
    }

    const bestAuthor = this.findBestAuthorMatch(authorQuery, authors, params);
    if (!bestAuthor) {
      return null;
    }

    return this.isConfidentClarivateAuthorSelection(
      authorQuery,
      authors,
      bestAuthor,
      params,
    )
      ? bestAuthor
      : null;
  }

  private scoreAuthorMatch(
    authorQuery: string,
    author: {
      displayName: string;
      wosStandard?: string;
      documentCount: number;
    },
  ) {
    const queryParts = this.normalizeNameParts(authorQuery);
    const candidate = this.normalizeNameParts(
      `${author.displayName} ${author.wosStandard ?? ''}`,
    );
    const candidateText = candidate.parts.join(' ');
    const candidateCompact = candidate.parts.join('');
    let score = author.documentCount;

    if (!queryParts.surname) {
      return score;
    }

    const queryFull = [queryParts.surname, ...queryParts.givenNames].join(' ');
    const surnameInitials = `${queryParts.surname}${queryParts.initials.toLowerCase()}`;

    if (candidateText.includes(queryFull)) {
      score += 100;
    }
    if (queryParts.initials && candidateCompact.includes(surnameInitials)) {
      score += 90;
    }
    if (candidate.parts.includes(queryParts.surname)) {
      score += 25;
    }
    if (
      queryParts.givenNames.length > 0 &&
      queryParts.givenNames.every((part) => candidate.parts.includes(part))
    ) {
      score += 20;
    }

    return score;
  }

  private scoreAuthorSelection(
    authorQuery: string,
    author: ClarivateAuthorMatch,
    params?: ClarivateSearchAuthorsParams,
  ) {
    return (
      this.scoreAuthorMatch(authorQuery, author) +
      this.scoreAffiliationPreference(author.affiliations, params)
    );
  }

  private isConfidentClarivateAuthorSelection(
    authorQuery: string,
    authors: ClarivateAuthorMatch[],
    selectedAuthor: ClarivateAuthorMatch,
    params: ClarivateSearchAuthorsParams,
  ) {
    const preferredResearcherId = this.normalizeIdentifier(
      params.preferredResearcherId,
    );
    const preferredWosStandard = this.normalizeIdentifier(
      params.preferredWosStandard,
    );

    if (
      (preferredResearcherId &&
        this.normalizeIdentifier(selectedAuthor.researcherId) ===
          preferredResearcherId) ||
      (preferredWosStandard &&
        this.normalizeIdentifier(selectedAuthor.wosStandard) ===
          preferredWosStandard)
    ) {
      return true;
    }

    const normalizedDisplayName = this.normalizeIdentifier(
      selectedAuthor.displayName,
    );
    const sameNameCandidates = authors.filter(
      (author) =>
        this.normalizeIdentifier(author.displayName) === normalizedDisplayName,
    );

    if (sameNameCandidates.length <= 1) {
      return true;
    }

    const ranked = [...sameNameCandidates]
      .map((author) => ({
        author,
        score: this.scoreAuthorSelection(authorQuery, author, params),
        affiliationScore: this.scoreAffiliationPreference(
          author.affiliations,
          params,
        ),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.affiliationScore - left.affiliationScore ||
          right.author.documentCount - left.author.documentCount,
      );
    const top = ranked[0];
    const second = ranked[1];

    if (!top || top.author !== selectedAuthor) {
      return false;
    }

    if (top.affiliationScore > 0 && (!second || top.score - second.score >= 8)) {
      return true;
    }

    return false;
  }

  private extractPublicationsForAuthor(
    hits: unknown,
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      affiliations?: string[];
    } | null,
    authorQuery: string,
  ) {
    if (!Array.isArray(hits)) {
      return [];
    }

    return hits
      .map((hit) => this.toPublicationSummary(hit, author, authorQuery))
      .filter((item) => item !== null);
  }

  private toPublicationSummary(
    hit: unknown,
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      affiliations?: string[];
    } | null,
    authorQuery: string,
  ) {
    if (!hit || typeof hit !== 'object') {
      return null;
    }

    const hitObject = hit as Record<string, unknown>;
    const names = this.readObject(hitObject.names);
    const matchingAuthor = this.findMatchingAuthorInHit(
      hitObject,
      author,
      authorQuery,
    );

    if (author && !matchingAuthor) {
      return null;
    }

    const source = this.readObject(hitObject.source);
    const identifiers = this.readObject(hitObject.identifiers);
    const links = this.readObject(hitObject.links);
    const authors = this.extractAuthorDisplayNames(names?.authors);
    const citations = Array.isArray(hitObject.citations)
      ? hitObject.citations
          .map((item) => this.readObject(item))
          .filter((item): item is Record<string, unknown> => item !== null)
          .map((item) => ({
            db: this.readString(item.db),
            count: this.readNumber(item.count),
          }))
      : [];

    return {
      uid: this.readString(hitObject.uid),
      title: this.readString(hitObject.title),
      authorNameInRecord: matchingAuthor
        ? this.readString(matchingAuthor.displayName)
        : null,
      matchedDisplayName: matchingAuthor
        ? this.readString(matchingAuthor.displayName)
        : null,
      sourceTitle: this.readString(source?.sourceTitle),
      publishYear: this.readNumber(source?.publishYear),
      publishMonth: this.readString(source?.publishMonth),
      volume: this.readString(source?.volume),
      issue: this.readString(source?.issue),
      pages: this.normalizePages(source?.pages),
      types: Array.isArray(hitObject.types) ? hitObject.types : [],
      sourceTypes: Array.isArray(hitObject.sourceTypes)
        ? hitObject.sourceTypes
        : [],
      authors,
      doi: this.readString(identifiers?.doi),
      pmid: this.readString(identifiers?.pmid),
      issn: this.readString(identifiers?.issn),
      citationCount: this.extractCitationCount(citations),
      matchedResearcherId: matchingAuthor
        ? this.readString(matchingAuthor.researcherId)
        : null,
      matchedWosStandard: matchingAuthor
        ? this.readString(matchingAuthor.wosStandard)
        : null,
      matchedAffiliations: matchingAuthor
        ? this.collectPossibleAffiliations(matchingAuthor)
        : [],
      citations,
      recordUrl: this.readString(links?.record),
    };
  }

  private findMatchingAuthorInHit(
    hitObject: Record<string, unknown>,
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      affiliations?: string[];
    } | null,
    authorQuery: string,
  ) {
    const names = this.readObject(hitObject.names);
    const authors = Array.isArray(names?.authors) ? names.authors : [];
    let bestAuthor: Record<string, unknown> | null = null;
    let bestScore = 0;
    const preferredResearcherId = author?.researcherId?.trim();
    const preferredWosStandard = author?.wosStandard?.trim();

    for (const item of authors) {
      const candidate = this.readObject(item);
      if (!candidate) {
        continue;
      }

      const candidateResearcherId = this.readString(candidate.researcherId);
      const candidateWosStandard = this.readString(candidate.wosStandard);
      const candidateAffiliations = this.collectPossibleAffiliations(candidate);
      const affiliationScore = this.scoreAffiliationPreference(
        candidateAffiliations,
        {
          preferredAffiliations: author?.affiliations,
        },
      );

      if (
        preferredResearcherId &&
        candidateResearcherId === preferredResearcherId
      ) {
        return candidate;
      }

      if (
        !preferredResearcherId &&
        preferredWosStandard &&
        candidateWosStandard === preferredWosStandard
      ) {
        if (
          (author?.affiliations?.length ?? 0) === 0 ||
          candidateAffiliations.length === 0 ||
          affiliationScore >= 0
        ) {
          return candidate;
        }

        continue;
      }

      if (
        (preferredResearcherId &&
          candidateResearcherId &&
          candidateResearcherId !== preferredResearcherId) ||
        (preferredWosStandard &&
          candidateWosStandard &&
          candidateWosStandard !== preferredWosStandard)
      ) {
        continue;
      }

      if (
        !preferredResearcherId &&
        !preferredWosStandard &&
        (author?.affiliations?.length ?? 0) > 0 &&
        candidateAffiliations.length > 0 &&
        affiliationScore < 0
      ) {
        continue;
      }

      const score =
        this.scoreAuthorMatch(authorQuery, {
        displayName: this.readString(candidate.displayName) ?? '',
        wosStandard: candidateWosStandard ?? undefined,
        documentCount: 0,
      }) + Math.max(affiliationScore, 0);
      if (score > bestScore) {
        bestScore = score;
        bestAuthor = candidate;
      }
    }

    return bestScore >= 90 ? bestAuthor : null;
  }

  private extractAffiliationsForAuthor(
    hits: unknown,
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      affiliations?: string[];
    } | null,
    authorQuery: string,
  ) {
    if (!Array.isArray(hits)) {
      return [];
    }

    const affiliations = new Set<string>();
    for (const hit of hits) {
      if (!hit || typeof hit !== 'object') {
        continue;
      }

      const matchingAuthor = this.findMatchingAuthorInHit(
        hit as Record<string, unknown>,
        author,
        authorQuery,
      );
      if (!matchingAuthor) {
        continue;
      }

      for (const value of this.collectPossibleAffiliations(matchingAuthor)) {
        affiliations.add(value);
      }
    }

    return Array.from(affiliations).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  private filterPublicationsByAuthorContext(
    publications: Array<Record<string, unknown>>,
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      affiliations?: string[];
    } | null,
  ) {
    if (!author || (author.affiliations?.length ?? 0) === 0) {
      return publications;
    }

    return publications.filter((publication) => {
      const matchedAffiliations = Array.isArray(publication.matchedAffiliations)
        ? publication.matchedAffiliations
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

      if (matchedAffiliations.length === 0) {
        return false;
      }

      return (
        this.scoreAffiliationPreference(matchedAffiliations, {
          preferredAffiliations: author.affiliations,
        }) >= 0
      );
    });
  }

  private collectPossibleAffiliations(value: unknown) {
    const result = new Set<string>();
    const visit = (item: unknown, key = '') => {
      if (!item) {
        return;
      }

      const normalizedKey = key.toLowerCase();
      const looksLikeAffiliation =
        normalizedKey.includes('affil') ||
        normalizedKey.includes('address') ||
        normalizedKey.includes('organization') ||
        normalizedKey.includes('institution');

      if (typeof item === 'string') {
        const text = item.trim();
        if (looksLikeAffiliation && text) {
          result.add(text);
        }
        return;
      }

      if (Array.isArray(item)) {
        for (const child of item) {
          visit(child, key);
        }
        return;
      }

      if (typeof item === 'object') {
        for (const [childKey, childValue] of Object.entries(
          item as Record<string, unknown>,
        )) {
          visit(childValue, childKey);
        }
      }
    };

    visit(value);
    return Array.from(result);
  }

  private extractAuthorDisplayNames(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.readObject(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => this.readString(item.displayName))
      .filter((item): item is string => Boolean(item));
  }

  private buildClarivateAuthorKey(input: {
    displayName: string;
    researcherId?: string;
    wosStandard?: string;
    affiliations: string[];
  }) {
    if (input.researcherId?.trim()) {
      return input.researcherId.trim();
    }

    const primaryAffiliation = this.buildPrimaryAffiliationSignature(
      input.affiliations,
    );
    if (input.wosStandard?.trim() && primaryAffiliation) {
      return `${input.wosStandard.trim()}|${primaryAffiliation}`;
    }
    if (input.displayName.trim() && primaryAffiliation) {
      return `${input.displayName.trim().toLowerCase()}|${primaryAffiliation}`;
    }

    return input.wosStandard?.trim() || input.displayName.trim().toLowerCase();
  }

  private buildPrimaryAffiliationSignature(affiliations: string[]) {
    const normalized = affiliations
      .map((item) => this.normalizeAffiliationText(item))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);

    return normalized[0] ?? '';
  }

  private scoreAffiliationPreference(
    candidateAffiliations: string[],
    params?: Pick<
      ClarivateSearchAuthorsParams,
      | 'preferredAffiliations'
      | 'preferredUniversity'
      | 'preferredCity'
      | 'preferredCountry'
    >,
  ) {
    const preferredAffiliations = (params?.preferredAffiliations ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    const preferredUniversity = params?.preferredUniversity?.trim();
    const preferredCity = params?.preferredCity?.trim();
    const preferredCountry = params?.preferredCountry?.trim();

    if (
      preferredAffiliations.length === 0 &&
      !preferredUniversity &&
      !preferredCity &&
      !preferredCountry
    ) {
      return 0;
    }

    if (candidateAffiliations.length === 0) {
      return 0;
    }

    let score = 0;
    const normalizedAffiliations = candidateAffiliations.map((item) =>
      this.normalizeAffiliationText(item),
    );
    const universityMatched = preferredUniversity
      ? normalizedAffiliations.some((item) =>
          this.hasStrongAffiliationOverlap(item, preferredUniversity),
        )
      : false;
    const affiliationMatched =
      preferredAffiliations.length > 0
        ? preferredAffiliations.some((preference) =>
            normalizedAffiliations.some((item) =>
              this.hasStrongAffiliationOverlap(item, preference),
            ),
          )
        : false;
    const cityMatched = preferredCity
      ? normalizedAffiliations.some((item) =>
          item.includes(this.normalizeAffiliationText(preferredCity)),
        )
      : false;
    const countryMatched = preferredCountry
      ? normalizedAffiliations.some((item) =>
          item.includes(this.normalizeAffiliationText(preferredCountry)),
        )
      : false;

    if (universityMatched || affiliationMatched) {
      score += 45;
    } else if (preferredUniversity || preferredAffiliations.length > 0) {
      score -= 35;
    }

    if (cityMatched) {
      score += 12;
    } else if (preferredCity) {
      score -= 6;
    }

    if (countryMatched) {
      score += 6;
    } else if (preferredCountry) {
      score -= 3;
    }

    return score;
  }

  private hasStrongAffiliationOverlap(candidateText: string, preferredText: string) {
    const normalizedCandidate = this.normalizeAffiliationText(candidateText);
    const normalizedPreferred = this.normalizeAffiliationText(preferredText);

    if (!normalizedCandidate || !normalizedPreferred) {
      return false;
    }

    if (
      normalizedCandidate.includes(normalizedPreferred) ||
      normalizedPreferred.includes(normalizedCandidate)
    ) {
      return true;
    }

    const candidateTokens = normalizedCandidate
      .split(' ')
      .filter((token) => token.length > 2)
      .filter((token) => !this.affiliationNoiseTokens.has(token));
    const preferredTokens = normalizedPreferred
      .split(' ')
      .filter((token) => token.length > 2)
      .filter((token) => !this.affiliationNoiseTokens.has(token));

    if (candidateTokens.length === 0 || preferredTokens.length === 0) {
      return false;
    }

    const candidateSet = new Set(candidateTokens);
    const shared = preferredTokens.filter((token) => candidateSet.has(token));

    if (shared.length >= Math.min(2, preferredTokens.length, candidateTokens.length)) {
      return true;
    }

    return (
      shared.length >= 1 &&
      shared.some((token) => token.length >= 6) &&
      preferredTokens.length === 1
    );
  }

  private normalizeAffiliationText(value: string) {
    return this.foldSearchText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizePages(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    const pageObject = this.readObject(value);
    if (!pageObject) {
      return null;
    }

    const direct = this.readString(
      pageObject.pageRange ?? pageObject.page ?? pageObject.value,
    );
    if (direct) {
      return direct;
    }

    const start =
      this.readString(pageObject.begin) ??
      this.readString(pageObject.start) ??
      this.readString(pageObject.first) ??
      this.readString(pageObject.firstPage);
    const end =
      this.readString(pageObject.end) ??
      this.readString(pageObject.last) ??
      this.readString(pageObject.lastPage);

    if (start && end) {
      return `${start}-${end}`;
    }

    return start || end || null;
  }

  private extractCitationCount(
    citations: Array<{ db: string | null; count: number | null }>,
  ) {
    const counts = citations
      .map((item) => item.count)
      .filter((item): item is number => typeof item === 'number');

    if (counts.length === 0) {
      return null;
    }

    return Math.max(...counts);
  }

  private clampDocumentsLimit(value?: number) {
    if (!Number.isFinite(value) || !value) {
      return 10;
    }

    return Math.min(Math.max(Math.floor(value), 1), 50);
  }

  private resolveStartPage(value?: number) {
    if (!Number.isFinite(value) || !value || value < 1) {
      return 1;
    }

    return Math.floor(value);
  }

  private resolveMaxPages(value: number | undefined, limit: number) {
    if (!Number.isFinite(value) || !value || value < 1) {
      return 1;
    }

    return Math.max(1, Math.floor(value));
  }

  private shouldContinueAuthorPagination(
    metadata: unknown,
    hitCount: number,
    limit: number,
    currentPage: number,
    pagesFetched: number,
    maxPages: number,
  ) {
    if (hitCount === 0 || hitCount < limit || pagesFetched >= maxPages) {
      return false;
    }

    const metadataObject = this.readObject(metadata);
    const total =
      this.readNumber(metadataObject?.total) ??
      this.readNumber(metadataObject?.totalRecords) ??
      this.readNumber(metadataObject?.recordsFound);

    if (typeof total === 'number' && total > 0) {
      return currentPage * limit < total;
    }

    return true;
  }

  private normalizeNameParts(value: string) {
    const trimmed = value.trim();
    const commaAware = trimmed.includes(',')
      ? (() => {
          const [left, right] = trimmed.split(',').map((item) => item.trim());
          if (!left || !right) {
            return trimmed;
          }
          return `${right} ${left}`;
        })()
      : trimmed;

    const parts = this.foldSearchText(commaAware)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const givenNames = parts.length > 1 ? parts.slice(0, -1) : [];
    const initials = givenNames
      .map((part) => part[0]?.toUpperCase())
      .filter(Boolean)
      .join('');

    return {
      parts,
      surname,
      givenNames,
      initials,
    };
  }

  private promoteAuthorDisplayNameFromQuery(
    displayName: string,
    wosStandard: string | undefined,
    preferredDisplayName: string,
  ) {
    const queryParts = this.normalizeNameParts(preferredDisplayName);
    const candidateSource = [displayName, wosStandard]
      .map((item) => item?.trim())
      .find(Boolean);

    if (!candidateSource || !queryParts.surname) {
      return null;
    }

    const candidateParts = this.normalizeNameParts(candidateSource);
    const initialOnlyCandidate =
      candidateParts.givenNames.length > 0 &&
      candidateParts.givenNames.every((item) => item.length <= 2);

    if (!initialOnlyCandidate) {
      return null;
    }

    if (candidateParts.surname !== queryParts.surname) {
      return null;
    }

    if (!candidateParts.initials || !queryParts.initials) {
      return null;
    }

    if (
      queryParts.initials.startsWith(candidateParts.initials) ||
      candidateParts.initials.startsWith(queryParts.initials)
    ) {
      return preferredDisplayName.trim();
    }

    return null;
  }

  private readObject(value: unknown) {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : null;
  }

  private readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private normalizeIdentifier(value?: string) {
    return this.foldSearchText(value ?? '').toLowerCase().trim();
  }

  private extractResearcherProfile(data: Record<string, unknown>) {
    const root = this.readObject(data);
    const hit =
      Array.isArray(root?.hits) && root.hits.length > 0
        ? this.readObject(root.hits[0])
        : root;

    if (!hit) {
      return null;
    }

    const displayName =
      this.readString(hit.displayName) ??
      this.readString(hit.fullName) ??
      this.readString(this.readObject(hit.name)?.displayName) ??
      this.readString(this.readObject(hit.name)?.fullName) ??
      this.readString(this.readObject(hit.names)?.displayName) ??
      this.readString(this.readObject(hit.names)?.fullName) ??
      this.buildPersonNameFromParts(hit) ??
      undefined;

    const researcherId =
      this.readString(hit.researcherId) ??
      this.readStringArray(hit.rid)[0] ??
      this.readString(this.readObject(hit.ids)?.researcherId) ??
      undefined;
    const wosStandard =
      this.readString(hit.wosStandard) ??
      this.readString(this.readObject(hit.name)?.wosStandard) ??
      this.readString(this.readObject(hit.names)?.wosStandard) ??
      undefined;

    return {
      displayName,
      researcherId,
      wosStandard,
      affiliations: this.collectPossibleAffiliations(hit),
      raw: hit,
    } satisfies ClarivateResearcherProfile;
  }

  private buildPersonNameFromParts(hit: Record<string, unknown>) {
    const candidates = [
      hit,
      this.readObject(hit.name),
      this.readObject(hit.names),
      this.readObject(hit.person),
    ].filter((item): item is Record<string, unknown> => item !== null);

    for (const candidate of candidates) {
      const firstName =
        this.readString(candidate.firstName) ??
        this.readString(candidate.givenName) ??
        this.readString(candidate.givenNames);
      const lastName =
        this.readString(candidate.lastName) ??
        this.readString(candidate.familyName) ??
        this.readString(candidate.surname);

      if (firstName && lastName) {
        return `${firstName} ${lastName}`.trim();
      }
    }

    return null;
  }

  private mergeStringArrays(current: string[], incoming: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of [...current, ...incoming]) {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }

      const key = this.normalizeAffiliationText(trimmed);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(trimmed);
    }

    return result;
  }
}
