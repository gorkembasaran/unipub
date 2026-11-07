import { Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { PublicationSyncService } from '../catalog/publication-sync.service';
import { ClarivateService } from '../clarivate/clarivate.service';
import {
  InstitutionNameInput,
  areInstitutionNamesEquivalent,
  deriveInstitutionFacetKey,
  extractInstitutionNameCandidate,
  resolveInstitutionIdentity,
} from '../common/institution-normalization';
import { ScraperService } from '../scraper/scraper.service';
import { SerpapiService } from '../serpapi/serpapi.service';
import { TrdizinService } from '../trdizin/trdizin.service';

type ParsedAffiliation = {
  raw: string;
  platform?: string;
  personTitle?: string;
  role?: string;
  department?: string;
  faculty?: string;
  university?: string;
  institutionCanonicalName?: string;
  institutionCanonicalKey?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
  tokens: string[];
};

type UnifiedAuthorCandidate = {
  displayName: string;
  normalizedName: string;
  affiliations: ParsedAffiliation[];
  affiliationRaw: string[];
  searchIndex: {
    keywords: string[];
    university?: string;
    institutionKey?: string;
    institutionAliases: string[];
    city?: string;
    country?: string;
    emailDomain?: string;
  };
  sourceProfiles: Array<{
    platform: string;
    externalAuthorId: string;
    profileUrl?: string;
    score?: number;
  }>;
  score: number;
};

type IdentityMatchResult = {
  score: number;
  shouldMerge: boolean;
};

type DiscoveryResponseCandidate = UnifiedAuthorCandidate & {
  dbAuthorId: string;
  dbStatus: string;
  dbMatchScore?: number;
};

type DiscoveryAuthorFilters = {
  country?: string;
  city?: string;
  school?: string;
  institution?: string;
  university?: string;
};

type NormalizedDiscoveryAuthorFilters = {
  country?: string;
  city?: string;
  institution?: string;
};

type QueryNameSignature = {
  normalizedQuery: string;
  tokens: string[];
  surname?: string;
  givenTokens: string[];
  compactInitials?: string;
};

type QueryNameMatchResult = {
  score: number;
  exact: boolean;
  initialsMatch: boolean;
  subset: boolean;
  surnameMatch: boolean;
};

type DiscoveryFilterOption = {
  value: string;
  label: string;
  count: number;
  countryValue?: string;
  cityValue?: string;
};

const COUNTRY_KEY_ALIASES: Record<string, string> = {
  turkiye: 'turkiye',
  turkey: 'turkiye',
  turkiyecumhuriyeti: 'turkiye',
  tr: 'turkiye',
  usa: 'usa',
  us: 'usa',
  unitedstates: 'usa',
  unitedstatesofamerica: 'usa',
  amerika: 'usa',
  amerikabirlesikdevletleri: 'usa',
  abd: 'usa',
  germany: 'germany',
  deutschland: 'germany',
  almanya: 'germany',
  france: 'france',
  fransa: 'france',
  uk: 'uk',
  unitedkingdom: 'uk',
  england: 'uk',
  ingiltere: 'uk',
};

const COUNTRY_DISPLAY_LABELS: Record<string, string> = {
  turkiye: 'Türkiye',
  usa: 'USA',
  germany: 'Germany',
  france: 'France',
  uk: 'UK',
};

const AUTHOR_IDENTITY_MATCH_THRESHOLD = 0.7;
const AUTHOR_NAME_NOISE_TOKENS = new Set([
  'dr',
  'prof',
  'assoc',
  'asst',
  'assistant',
  'professor',
  'google',
  'scholar',
  'akademik',
  'citation',
  'citations',
  'profile',
  'profiles',
  'profil',
  'author',
  'authors',
]);

const SINGLE_AUTHOR_PROFILE_PLATFORMS = new Set([
  'trdizin',
  'serpapi_scholar',
  'clarivate_wos',
  'scraper_scopus',
  'scopus_scraper',
]);

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly serpapiService: SerpapiService,
    private readonly trdizinService: TrdizinService,
    private readonly scraperService: ScraperService,
    private readonly clarivateService: ClarivateService,
    private readonly catalogService: CatalogService,
    private readonly publicationSyncService: PublicationSyncService,
  ) {}

  async getAuthorById(id: string) {
    return this.catalogService.getAuthorById(id);
  }

  async syncAuthorPublications(
    id: string,
    limitPerSource: number,
    options: {
      force?: boolean;
      publishedFrom?: Date;
      publishedTo?: Date;
    } = {},
  ) {
    return this.publicationSyncService.syncAuthorPublications(
      id,
      limitPerSource,
      options,
    );
  }

  async listPublications(input: {
    authorId?: string;
    query?: string;
    publishedFrom?: Date;
    publishedTo?: Date;
  }) {
    return this.catalogService.listPublications(input);
  }

  async discoverAuthors(
    query: string,
    limit = 10,
    filters: DiscoveryAuthorFilters = {},
  ) {
    const normalizedFilters = this.normalizeRequestedFilters(filters);
    this.logger.log(
      `discoverAuthors started query="${query}" limit=${limit} filters=${JSON.stringify(normalizedFilters)}`,
    );

    const dbSearchLimit = Math.min(Math.max(limit * 6, 60), 200);
    const dbCandidates = await this.catalogService.searchAuthorsDbOnly(
      query,
      dbSearchLimit,
      normalizedFilters,
    );
    const rankedDbCandidates = this.mergeResponseCandidates(
      this.rankDbCandidates(query, dbCandidates, normalizedFilters),
    );
    const relevantDbCandidates = this.reconcileQueryResponseVariants(
      query,
      this.selectRelevantDbCandidates(
        query,
        rankedDbCandidates,
      ).slice(0, limit),
    );

    this.logger.log(
      `discoverAuthors DB scan query="${query}" pool=${dbCandidates.length} ranked=${rankedDbCandidates.length} relevant=${relevantDbCandidates.length}`,
    );

    // The public demo never calls providers: it only serves seeded catalog data.
    const dbOnly = ['1', 'true', 'yes', 'on'].includes(
      (process.env.DEMO_MODE ?? '').trim().toLowerCase(),
    );

    if (relevantDbCandidates.length >= limit || dbOnly) {
      const formattedDbCandidates = relevantDbCandidates.map((item) =>
        this.formatDiscoveryResponseCandidateOutput(item),
      );
      this.logger.log(
        `discoverAuthors DB-first coverage query="${query}" count=${relevantDbCandidates.length}. Skipping provider calls.`,
      );
      return {
        query,
        total: formattedDbCandidates.length,
        filters: normalizedFilters,
        providers: {
          serpapi: 0,
          trdizin: 0,
          clarivate: 0,
          scraper: 0,
          scraperScopus: 0,
          scraperPubmed: 0,
        },
        source: 'db_first',
        items: formattedDbCandidates,
        fetchedAt: new Date().toISOString(),
      };
    }

    this.logger.log(
      `discoverAuthors DB coverage insufficient query="${query}" relevant=${relevantDbCandidates.length} requested=${limit}. Backfilling from providers.`,
    );

    const [
      serpapiResult,
      trdizinResult,
      scraperScopusResult,
      scraperPubmedResult,
      clarivateResult,
    ] = await Promise.allSettled([
      this.serpapiService.searchAuthorsNormalized({
        q: query,
        hl: 'tr',
        limit: Math.max(limit * 2, 20),
      }),
      this.trdizinService.searchAuthorsNormalized({
        q: query,
        limit: Math.max(limit * 2, 20),
      }),
      this.scraperService.searchScopusAuthors(query, Math.max(limit * 2, 20)),
      this.scraperService.searchPubmedAuthor(query, Math.max(limit * 2, 20)),
      this.clarivateService.searchAuthors({
        q: query,
        limit: Math.min(Math.max(limit * 2, 20), 50),
        includeCandidates: true,
        maxPages: 2,
      }),
    ]);

    const fromSerpapi: UnifiedAuthorCandidate[] =
      serpapiResult.status === 'fulfilled'
        ? (serpapiResult.value.authors ?? []).map((author) =>
            this.mapSerpapiAuthor(author),
          )
        : [];

    const fromTrdizin: UnifiedAuthorCandidate[] =
      trdizinResult.status === 'fulfilled'
        ? (trdizinResult.value.authors ?? []).map((author) =>
            this.mapTrdizinAuthor(author),
          )
        : [];

    const fromScraperScopus: UnifiedAuthorCandidate[] =
      scraperScopusResult.status === 'fulfilled'
        ? (scraperScopusResult.value.authors ?? []).map((author) =>
            this.mapScopusScraperAuthor(author),
          )
        : [];

    const fromScraperPubmed: UnifiedAuthorCandidate[] =
      scraperPubmedResult.status === 'fulfilled'
        ? this.mapPubmedScraperAuthors(query, scraperPubmedResult.value)
        : [];

    const fromClarivate: UnifiedAuthorCandidate[] =
      clarivateResult.status === 'fulfilled'
        ? this.mapClarivateCandidates(
            query,
            clarivateResult.value as Record<string, unknown>,
            limit,
          )
        : [];

    const merged = this.rankUnifiedCandidates(
      query,
      this.mergeAndDeduplicate(
        this.reconcileClarivateAbbreviations(query, [
          ...fromSerpapi,
          ...fromTrdizin,
          ...fromScraperScopus,
          ...fromScraperPubmed,
          ...fromClarivate,
        ]),
      ),
      normalizedFilters,
    ).slice(0, limit);
    const persisted: DiscoveryResponseCandidate[] = [];
    for (const item of merged) {
      const saved = await this.catalogService.upsertDiscoveredAuthor({
        displayName: item.displayName,
        normalizedName: item.normalizedName,
        affiliationRaw: item.affiliationRaw,
        parsedAffiliations: item.affiliations,
        searchKeywords: item.searchIndex.keywords,
        institutionAliases: item.searchIndex.institutionAliases,
        university: item.searchIndex.university,
        city: item.searchIndex.city,
        country: item.searchIndex.country,
        emailDomain: item.searchIndex.emailDomain,
        sourceProfiles: item.sourceProfiles,
      });

      persisted.push(
        this.mapPersistedCatalogAuthorToDiscoveryCandidate(saved.author, {
          score: item.score,
          dbAuthorId: saved.authorId,
          dbStatus: saved.status,
        }),
      );
    }

    const responseItems = this.reconcileQueryResponseVariants(
      query,
      this.mergeResponseCandidates([
        ...relevantDbCandidates,
        ...persisted,
      ]),
    ).slice(0, limit);
    const formattedResponseItems = responseItems.map((item) =>
      this.formatDiscoveryResponseCandidateOutput(item),
    );

    this.logger.log(
      `discoverAuthors completed query="${query}" serpapi=${fromSerpapi.length} trdizin=${fromTrdizin.length} clarivate=${fromClarivate.length} scraperScopus=${fromScraperScopus.length} scraperPubmed=${fromScraperPubmed.length} merged=${merged.length} persisted=${persisted.length}`,
    );

    return {
      query,
      total: formattedResponseItems.length,
      filters: normalizedFilters,
      providers: {
        serpapi: fromSerpapi.length,
        trdizin: fromTrdizin.length,
        clarivate: fromClarivate.length,
        scraper: fromScraperScopus.length + fromScraperPubmed.length,
        scraperScopus: fromScraperScopus.length,
        scraperPubmed: fromScraperPubmed.length,
      },
      source: relevantDbCandidates.length > 0 ? 'db_plus_providers' : 'providers',
      items: formattedResponseItems,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getAuthorFilters(filters: DiscoveryAuthorFilters = {}) {
    const normalizedFilters = this.normalizeRequestedFilters(filters);
    this.logger.log(
      `getAuthorFilters started filters=${JSON.stringify(normalizedFilters)}`,
    );

    const institutions = await this.catalogService.listInstitutionFilterSeeds();
    const countryMap = new Map<string, DiscoveryFilterOption>();
    const cityMap = new Map<string, DiscoveryFilterOption>();
    const schoolMap = new Map<string, DiscoveryFilterOption>();

    for (const rawInstitution of institutions) {
      const institution = this.toPlainRecord(rawInstitution);
      const relations = this.extractInstitutionFacetRelations(institution);
      const relationCount =
        typeof institution.authorCount === 'number' && institution.authorCount > 0
          ? institution.authorCount
          : 1;
      const seenCountries = new Set<string>();
      const seenCities = new Set<string>();
      const seenSchools = new Set<string>();

      for (const relation of relations) {
        if (relation.countryKey && !seenCountries.has(relation.countryKey)) {
          this.bumpFacetOption(
            countryMap,
            relation.countryKey,
            relation.countryLabel,
            {},
            relationCount,
          );
          seenCountries.add(relation.countryKey);
        }

        if (
          relation.cityKey &&
          (!normalizedFilters.country ||
            relation.countryKey === normalizedFilters.country)
        ) {
          const cityCompositeKey = `${relation.countryKey ?? 'global'}:${relation.cityKey}`;
          if (!seenCities.has(cityCompositeKey)) {
            this.bumpFacetOption(
              cityMap,
              cityCompositeKey,
              relation.cityLabel,
              {
                countryValue: relation.countryKey,
              },
              relationCount,
            );
            seenCities.add(cityCompositeKey);
          }
        }

        if (
          relation.institutionKey &&
          (!normalizedFilters.country ||
            relation.countryKey === normalizedFilters.country) &&
          (!normalizedFilters.city || relation.cityKey === normalizedFilters.city)
        ) {
          // Institutions should appear once in the filter list even if a
          // canonical record carries multiple aliases or partial location data.
          // Country/city dependency is already handled by the checks above,
          // so the institution key alone is enough here.
          const schoolCompositeKey = relation.institutionKey;
          if (!seenSchools.has(schoolCompositeKey)) {
            this.bumpFacetOption(
              schoolMap,
              schoolCompositeKey,
              relation.institutionLabel,
              {
                countryValue: relation.countryKey,
                cityValue: relation.cityKey,
              },
              relationCount,
            );
            seenSchools.add(schoolCompositeKey);
          }
        }
      }
    }

    const response = {
      selected: {
        country: normalizedFilters.country ?? null,
        city: normalizedFilters.city ?? null,
        school: normalizedFilters.institution ?? null,
      },
      countries: this.sortFacetOptions(Array.from(countryMap.values())),
      cities: this.sortFacetOptions(Array.from(cityMap.values())),
      schools: this.sortFacetOptions(Array.from(schoolMap.values())),
      fetchedAt: new Date().toISOString(),
    };

    this.logger.log(
      `getAuthorFilters completed countries=${response.countries.length} cities=${response.cities.length} schools=${response.schools.length}`,
    );

    return response;
  }

  private rankDbCandidates(
    query: string,
    items: Array<Record<string, unknown>>,
    filters: NormalizedDiscoveryAuthorFilters,
  ): DiscoveryResponseCandidate[] {
    const querySignature = this.buildQueryNameSignature(query);

    return items
      .map((item) => {
        const fullName = this.readString(item, 'fullName') ?? '';
        const normalizedName =
          this.normalizePersonName(fullName) ||
          this.normalizePersonName(this.readString(item, 'normalizedName') ?? '');
        const mappedAffiliations = this.mapDbAffiliations(item);
        const candidate: UnifiedAuthorCandidate = {
          displayName: this.readString(item, 'fullName') ?? 'Unknown',
          normalizedName:
            this.readString(item, 'normalizedName') ?? normalizedName,
          affiliations: mappedAffiliations,
          affiliationRaw: this.readStringArray(item, 'affiliations'),
          searchIndex: {
            keywords: this.readStringArray(item, 'searchKeywords'),
            university: this.readString(item, 'university') ?? undefined,
            institutionKey:
              this.readString(item, 'institutionCanonicalKey') ?? undefined,
            institutionAliases: this.readStringArray(
              item,
              'institutionAliases',
            ),
            city: this.readString(item, 'city') ?? undefined,
            country: this.readString(item, 'country') ?? undefined,
            emailDomain: this.readString(item, 'emailDomain') ?? undefined,
          },
          sourceProfiles: this.readSourceProfiles(item),
          score: 0,
        };

        if (!this.matchesRequestedFilters(candidate, filters)) {
          return null;
        }

        const nameVariants = [
          fullName,
          this.readString(item, 'normalizedName') ?? '',
          ...this.readStringArray(item, 'aliases'),
        ].filter(Boolean);
        const bestNameMatch = this.pickBestQueryNameMatch(
          querySignature,
          nameVariants,
          candidate.searchIndex.keywords,
        );

        if (!bestNameMatch || bestNameMatch.score <= 0) {
          return null;
        }

        let dbMatchScore = bestNameMatch.score;

        dbMatchScore = Math.min(
          1,
          dbMatchScore + this.computeFilterBoost(candidate, filters),
        );

        return {
          ...candidate,
          score: Math.round(dbMatchScore * 100),
          dbAuthorId: this.readString(item, '_id') ?? '',
          dbStatus: 'existing',
          dbMatchScore,
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => (b.dbMatchScore ?? 0) - (a.dbMatchScore ?? 0));
  }

  private mapPersistedCatalogAuthorToDiscoveryCandidate(
    item: Record<string, unknown>,
    input: {
      score: number;
      dbAuthorId: string;
      dbStatus: string;
      dbMatchScore?: number;
    },
  ): DiscoveryResponseCandidate {
    const fullName = this.readString(item, 'fullName') ?? 'Unknown';
    const normalizedName =
      this.readString(item, 'normalizedName') ??
      this.normalizePersonName(fullName);

    return {
      displayName: fullName,
      normalizedName,
      affiliations: this.mapDbAffiliations(item),
      affiliationRaw: this.readStringArray(item, 'affiliations'),
      searchIndex: {
        keywords: this.readStringArray(item, 'searchKeywords'),
        university: this.readString(item, 'university') ?? undefined,
        institutionKey:
          this.readString(item, 'institutionCanonicalKey') ?? undefined,
        institutionAliases: this.readStringArray(item, 'institutionAliases'),
        city: this.readString(item, 'city') ?? undefined,
        country: this.readString(item, 'country') ?? undefined,
        emailDomain: this.readString(item, 'emailDomain') ?? undefined,
      },
      sourceProfiles: this.readSourceProfiles(item),
      score: input.score,
      dbAuthorId: input.dbAuthorId,
      dbStatus: input.dbStatus,
      dbMatchScore: input.dbMatchScore,
    };
  }

  private selectRelevantDbCandidates(
    query: string,
    items: DiscoveryResponseCandidate[],
  ) {
    if (items.length === 0) {
      return [];
    }

    const querySignature = this.buildQueryNameSignature(query);
    const queryTokens = querySignature.tokens;
    const topScore = items[0]?.dbMatchScore ?? 0;
    const baseThreshold =
      queryTokens.length >= 3 ? 0.7 : queryTokens.length === 2 ? 0.68 : 0.58;
    const threshold = Math.max(baseThreshold, topScore - 0.25);

    return items.filter((item) => {
      const dbMatchScore = item.dbMatchScore ?? 0;
      if (dbMatchScore < threshold) {
        return false;
      }

      const normalizedCandidate =
        item.normalizedName || this.normalizePersonName(item.displayName);
      const candidateTokens = new Set(this.nameTokensForSignature(normalizedCandidate));
      const overlap = queryTokens.reduce(
        (count, token) => count + (candidateTokens.has(token) ? 1 : 0),
        0,
      );
      const bestNameMatch = this.pickBestQueryNameMatch(
        querySignature,
        [item.displayName, item.normalizedName],
        item.searchIndex.keywords,
      );

      if (queryTokens.length >= 2 && overlap < Math.min(2, queryTokens.length)) {
        const subsetMatch = bestNameMatch?.subset ?? false;
        const initialsMatch = bestNameMatch?.initialsMatch ?? false;
        if (!subsetMatch && !initialsMatch && dbMatchScore < 0.9) {
          return false;
        }
      }

      return true;
    });
  }

  private rankUnifiedCandidates(
    query: string,
    items: UnifiedAuthorCandidate[],
    filters: NormalizedDiscoveryAuthorFilters,
  ) {
    const querySignature = this.buildQueryNameSignature(query);

    return items
      .filter((item) => this.matchesRequestedFilters(item, filters))
      .map((item) => {
        const bestNameMatch = this.pickBestQueryNameMatch(
          querySignature,
          [item.displayName, item.normalizedName],
          item.searchIndex.keywords,
        );

        if (!bestNameMatch || bestNameMatch.score <= 0) {
          return null;
        }

        let rankingScore = item.score * 0.4 + bestNameMatch.score * 120;
        if (bestNameMatch.exact) {
          rankingScore += 12;
        } else if (bestNameMatch.subset) {
          rankingScore += 6;
        }
        if (bestNameMatch.initialsMatch) {
          rankingScore += 8;
        }
        rankingScore += this.computeFilterBoost(item, filters) * 100;

        return {
          ...item,
          score: Math.round(rankingScore),
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => b.score - a.score);
  }

  private normalizeRequestedFilters(
    filters: DiscoveryAuthorFilters,
  ): NormalizedDiscoveryAuthorFilters {
    const institution =
      filters.school?.trim() ||
      filters.institution?.trim() ||
      filters.university?.trim();

    return {
      country: filters.country
        ? this.normalizeCountryKey(filters.country)
        : undefined,
      city: filters.city ? this.normalizeFacetKey(filters.city) : undefined,
      institution: institution
        ? this.normalizeRequestedInstitutionFilter(institution)
        : undefined,
    };
  }

  private matchesRequestedFilters(
    candidate: UnifiedAuthorCandidate,
    filters: NormalizedDiscoveryAuthorFilters,
  ) {
    const candidateKeys = this.collectCandidateFacetKeys(candidate);

    if (
      filters.country &&
      !candidateKeys.countryKeys.has(filters.country)
    ) {
      return false;
    }

    if (filters.city && !candidateKeys.cityKeys.has(filters.city)) {
      return false;
    }

    if (
      filters.institution &&
      !candidateKeys.institutionKeys.has(filters.institution)
    ) {
      return false;
    }

    return true;
  }

  private computeFilterBoost(
    candidate: UnifiedAuthorCandidate,
    filters: NormalizedDiscoveryAuthorFilters,
  ) {
    const candidateKeys = this.collectCandidateFacetKeys(candidate);
    let boost = 0;

    if (
      filters.country &&
      candidateKeys.countryKeys.has(filters.country)
    ) {
      boost += 0.08;
    }

    if (filters.city && candidateKeys.cityKeys.has(filters.city)) {
      boost += 0.1;
    }

    if (
      filters.institution &&
      candidateKeys.institutionKeys.has(filters.institution)
    ) {
      boost += 0.12;
    }

    return boost;
  }

  private collectCandidateFacetKeys(candidate: UnifiedAuthorCandidate) {
    const countryKeys = new Set<string>();
    const cityKeys = new Set<string>();
    const institutionKeys = new Set<string>();

    const countries = [
      candidate.searchIndex.country,
      ...candidate.affiliations.map((item) => item.country),
    ];
    const cities = [
      candidate.searchIndex.city,
      ...candidate.affiliations.map((item) => item.city),
    ];
    const institutions = [
      candidate.searchIndex.university,
      ...candidate.searchIndex.institutionAliases,
      ...candidate.affiliations.map((item) => item.university),
      ...candidate.affiliations.map((item) => item.institutionCanonicalName),
      ...candidate.affiliations
        .map((item) => this.extractInstitutionNameFromAffiliation(item))
        .filter(Boolean),
    ];

    for (const country of countries) {
      const key = country ? this.normalizeCountryKey(country) : '';
      if (key) {
        countryKeys.add(key);
      }
    }

    for (const city of cities) {
      const key = city ? this.normalizeFacetKey(city) : '';
      if (key) {
        cityKeys.add(key);
      }
    }

    for (const institution of institutions) {
      const key = institution ? this.normalizeFacetKey(institution) : '';
      if (key) {
        institutionKeys.add(key);
      }
      const derivedKey = institution
        ? this.normalizeRequestedInstitutionFilter(institution)
        : '';
      if (derivedKey) {
        institutionKeys.add(derivedKey);
      }
    }

    if (candidate.searchIndex.institutionKey) {
      institutionKeys.add(candidate.searchIndex.institutionKey);
    }
    for (const item of candidate.affiliations) {
      if (item.institutionCanonicalKey) {
        institutionKeys.add(item.institutionCanonicalKey);
      }
    }

    return { countryKeys, cityKeys, institutionKeys };
  }

  private extractInstitutionFacetRelations(institution: Record<string, unknown>) {
    const canonicalName =
      this.readString(institution, 'canonicalName') ??
      this.readStringArray(institution, 'aliases')[0] ??
      undefined;
    const country = this.readString(institution, 'country') ?? undefined;
    const city = this.readString(institution, 'city') ?? undefined;
    const institutionKey =
      this.readString(institution, 'normalizedKey') ??
      (canonicalName
        ? this.normalizeRequestedInstitutionFilter(canonicalName)
        : undefined);

    const countryKey = country ? this.normalizeCountryKey(country) : undefined;
    const cityKey = city ? this.normalizeFacetKey(city) : undefined;

    if (!countryKey && !cityKey && !institutionKey) {
      return [];
    }

    return [
      {
        countryKey,
        countryLabel:
          countryKey && COUNTRY_DISPLAY_LABELS[countryKey]
            ? COUNTRY_DISPLAY_LABELS[countryKey]
            : country?.trim(),
        cityKey,
        cityLabel: city?.trim(),
        institutionKey,
        institutionLabel: canonicalName?.trim(),
      },
    ];
  }

  private extractAuthorFacetRelations(author: Record<string, unknown>) {
    const parsedAffiliations = this.mapDbAffiliations(author);
    const topCountry = this.readString(author, 'country') ?? undefined;
    const topCity = this.readString(author, 'city') ?? undefined;
    const topUniversity = this.readString(author, 'university') ?? undefined;
    const topInstitutionKey =
      this.readString(author, 'institutionCanonicalKey') ?? undefined;

    const rawRelations = [
      {
        country: topCountry,
        city: topCity,
        institution: topUniversity,
        institutionKey: topInstitutionKey,
      },
      ...parsedAffiliations.map((item) => ({
        country: item.country ?? topCountry,
        city: item.city ?? topCity,
        institution:
          item.institutionCanonicalName ?? item.university ?? topUniversity,
        institutionKey:
          item.institutionCanonicalKey ??
          topInstitutionKey ??
          undefined,
      })),
    ];

    const map = new Map<
      string,
      {
        countryKey?: string;
        countryLabel?: string;
        cityKey?: string;
        cityLabel?: string;
        institutionKey?: string;
        institutionLabel?: string;
      }
    >();

    for (const relation of rawRelations) {
      const countryKey = relation.country
        ? this.normalizeCountryKey(relation.country)
        : undefined;
      const cityKey = relation.city
        ? this.normalizeFacetKey(relation.city)
        : undefined;
      const institutionKey =
        (relation.institution
          ? this.normalizeRequestedInstitutionFilter(relation.institution)
          : undefined) ??
        relation.institutionKey ??
        (relation.institution
          ? this.normalizeFacetKey(relation.institution)
          : undefined);

      if (!countryKey && !cityKey && !institutionKey) {
        continue;
      }

      const compositeKey = [
        countryKey ?? '',
        cityKey ?? '',
        institutionKey ?? '',
      ].join('|');
      const existing = map.get(compositeKey);
      const next = {
        countryKey,
        countryLabel:
          countryKey && COUNTRY_DISPLAY_LABELS[countryKey]
            ? COUNTRY_DISPLAY_LABELS[countryKey]
            : relation.country?.trim(),
        cityKey,
        cityLabel: relation.city?.trim(),
        institutionKey,
        institutionLabel: relation.institution?.trim(),
      };

      if (!existing) {
        map.set(compositeKey, next);
        continue;
      }

      map.set(compositeKey, {
        countryKey: existing.countryKey ?? next.countryKey,
        countryLabel: this.pickBetterFacetLabel(
          existing.countryLabel,
          next.countryLabel,
        ),
        cityKey: existing.cityKey ?? next.cityKey,
        cityLabel: this.pickBetterFacetLabel(existing.cityLabel, next.cityLabel),
        institutionKey: existing.institutionKey ?? next.institutionKey,
        institutionLabel: this.pickBetterFacetLabel(
          existing.institutionLabel,
          next.institutionLabel,
        ),
      });
    }

    return Array.from(map.values());
  }

  private bumpFacetOption(
    map: Map<string, DiscoveryFilterOption>,
    key: string,
    label: string | undefined,
    relation: Pick<DiscoveryFilterOption, 'countryValue' | 'cityValue'> = {},
    increment = 1,
  ) {
    const existing = map.get(key);
    if (!existing) {
      const segments = key.split(':');
      map.set(key, {
        value: key.includes(':') ? segments[segments.length - 1] ?? key : key,
        label: label?.trim() || key,
        count: increment,
        ...relation,
      });
      return;
    }

    existing.count += increment;
    existing.label = this.pickBetterFacetLabel(existing.label, label) ?? existing.label;
    if (!existing.countryValue && relation.countryValue) {
      existing.countryValue = relation.countryValue;
    }
    if (!existing.cityValue && relation.cityValue) {
      existing.cityValue = relation.cityValue;
    }
  }

  private sortFacetOptions(options: DiscoveryFilterOption[]) {
    return options.sort((left, right) =>
      left.label.localeCompare(right.label, 'tr-TR', { sensitivity: 'base' }),
    );
  }

  private pickBetterFacetLabel(current?: string, incoming?: string) {
    if (!incoming?.trim()) {
      return current;
    }
    if (!current?.trim()) {
      return incoming.trim();
    }

    return this.scoreFacetLabel(incoming) > this.scoreFacetLabel(current)
      ? incoming.trim()
      : current.trim();
  }

  private scoreFacetLabel(value: string) {
    const trimmed = value.trim();
    const turkishCharBonus = /[çğıöşüÇĞİÖŞÜ]/.test(trimmed) ? 8 : 0;
    const startCaseScore = /^[A-ZÇĞİÖŞÜ0-9]/.test(trimmed) ? 10 : -12;
    const wordCountBonus = Math.min(trimmed.split(/\s+/).filter(Boolean).length, 6);
    const lengthBonus = Math.min(trimmed.length, 48) / 12;
    return turkishCharBonus + startCaseScore + wordCountBonus + lengthBonus;
  }

  private normalizeFacetKey(value: string) {
    return this.normalizeForSearch(value).replace(/\s+/g, '-');
  }

  private normalizeRequestedInstitutionFilter(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if (/^inst-[a-z0-9-]+$/i.test(trimmed)) {
      return trimmed.toLocaleLowerCase('en-US');
    }
    return deriveInstitutionFacetKey(trimmed) ?? this.normalizeFacetKey(trimmed);
  }

  private normalizeCountryKey(value: string) {
    const normalized = this.normalizeForSearch(value).replace(/\s+/g, '');
    return COUNTRY_KEY_ALIASES[normalized] ?? normalized;
  }

  private buildInstitutionInputs(candidate: UnifiedAuthorCandidate) {
    const inputs: InstitutionNameInput[] = [];

    if (candidate.searchIndex.university?.trim()) {
      const extracted = extractInstitutionNameCandidate(
        candidate.searchIndex.university.trim(),
      );
      if (extracted) {
        inputs.push({
          name: extracted,
          city: candidate.searchIndex.city,
          country: candidate.searchIndex.country,
        });
      }
    }

    for (const alias of candidate.searchIndex.institutionAliases ?? []) {
      const extracted = alias?.trim()
        ? extractInstitutionNameCandidate(alias.trim())
        : null;
      if (!extracted) {
        continue;
      }
      inputs.push({
        name: extracted,
        city: candidate.searchIndex.city,
        country: candidate.searchIndex.country,
      });
    }

    for (const item of candidate.affiliations) {
      const name = this.extractInstitutionNameFromAffiliation(item);
      if (!name) {
        continue;
      }
      inputs.push({
        name,
        platform: item.platform,
        city: item.city ?? candidate.searchIndex.city,
        country: item.country ?? candidate.searchIndex.country,
      });
    }

    return inputs;
  }

  private extractInstitutionNameFromAffiliation(item: ParsedAffiliation) {
    const canonical = item.institutionCanonicalName?.trim();
    if (canonical) {
      return extractInstitutionNameCandidate(canonical);
    }

    const university = item.university?.trim();
    if (university) {
      return extractInstitutionNameCandidate(university);
    }

    return extractInstitutionNameCandidate(item.raw);
  }

  private applyInstitutionIdentity<T extends UnifiedAuthorCandidate>(candidate: T): T {
    const resolved = resolveInstitutionIdentity(this.buildInstitutionInputs(candidate));
    if (!resolved) {
      return candidate;
    }

    const affiliations = candidate.affiliations.map((item) => {
      const name = this.extractInstitutionNameFromAffiliation(item);
      if (
        name &&
        !areInstitutionNamesEquivalent(name, resolved.canonicalName) &&
        name !== resolved.canonicalName
      ) {
        return item;
      }

      return {
        ...item,
        university: resolved.canonicalName,
        institutionCanonicalName: resolved.canonicalName,
        institutionCanonicalKey: resolved.normalizedKey,
      };
    });

    const keywords = new Set(candidate.searchIndex.keywords);
    for (const value of [resolved.canonicalName, ...resolved.aliases]) {
      for (const token of this.normalizeForSearch(value).split(' ')) {
        if (token) {
          keywords.add(token);
        }
      }
    }

    return {
      ...candidate,
      affiliations,
      searchIndex: {
        ...candidate.searchIndex,
        keywords: Array.from(keywords),
        university: resolved.canonicalName,
        institutionKey: resolved.normalizedKey,
        institutionAliases: resolved.aliases,
        city: candidate.searchIndex.city ?? resolved.city,
        country: candidate.searchIndex.country ?? resolved.country,
      },
    } as T;
  }

  private mergeAndDeduplicate(items: UnifiedAuthorCandidate[]) {
    const map = new Map<string, UnifiedAuthorCandidate>();
    let fallbackCounter = 0;

    for (const item of items) {
      const key =
        this.findMergeKey(map, item) ??
        this.primaryProfileKey(item) ??
        `${item.normalizedName}:${fallbackCounter++}`;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, this.applyInstitutionIdentity(item));
        continue;
      }
      map.set(key, this.mergeUnifiedCandidatePair(existing, item));
    }

    return Array.from(map.values()).sort((a, b) => b.score - a.score);
  }

  private mergeUnifiedCandidatePair(
    existing: UnifiedAuthorCandidate,
    item: UnifiedAuthorCandidate,
  ) {
    const mergedProfiles = [...existing.sourceProfiles];
    for (const profile of item.sourceProfiles) {
      const exists = mergedProfiles.some(
        (x) =>
          x.platform === profile.platform &&
          x.externalAuthorId === profile.externalAuthorId,
      );
      if (!exists) {
        mergedProfiles.push(profile);
      }
    }

    const mergedAffiliations = this.mergeAffiliations(
      existing.affiliations,
      item.affiliations,
    );
    const mergedAffiliationRaw = [
      ...existing.affiliationRaw,
      ...item.affiliationRaw,
    ].filter(Boolean);
    const canonicalIdentity = this.pickPreferredCanonicalIdentity(
      existing,
      item,
    );

    return this.applyInstitutionIdentity({
      ...existing,
      displayName: canonicalIdentity.displayName,
      normalizedName: canonicalIdentity.normalizedName,
      affiliations: mergedAffiliations,
      affiliationRaw: [...new Set(mergedAffiliationRaw)],
      searchIndex: this.mergeSearchIndex(existing.searchIndex, item.searchIndex),
      sourceProfiles: mergedProfiles,
      score: Math.max(existing.score, item.score),
    });
  }

  private reconcileClarivateAbbreviations(
    query: string,
    items: UnifiedAuthorCandidate[],
  ) {
    if (items.length < 2) {
      return items;
    }

    const querySignature = this.buildQueryNameSignature(query);
    const consumed = new Set<number>();
    const resolved: UnifiedAuthorCandidate[] = [];

    for (const [index, item] of items.entries()) {
      if (consumed.has(index)) {
        continue;
      }

      if (!this.isClarivateAbbreviatedCandidate(item)) {
        resolved.push(item);
        continue;
      }

      const matches = items
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate, candidateIndex }) =>
            candidateIndex !== index &&
            !consumed.has(candidateIndex) &&
            !this.hasPlatform(candidate, 'clarivate_wos') &&
            this.hasClarivateAbbreviationMatch(item, candidate) &&
            this.hasRichFullNameMatchForQuery(
              querySignature,
              candidate,
            ),
        );

      if (matches.length === 1) {
        const [{ candidate, candidateIndex }] = matches;
        consumed.add(index);
        consumed.add(candidateIndex);
        resolved.push(this.mergeUnifiedCandidatePair(candidate, item));
        continue;
      }

      resolved.push(item);
    }

    for (const [index, item] of items.entries()) {
      if (!consumed.has(index) && !resolved.includes(item)) {
        resolved.push(item);
      }
    }

    return resolved;
  }

  private reconcileQueryResponseVariants(
    query: string,
    items: DiscoveryResponseCandidate[],
  ) {
    if (items.length < 2) {
      return items;
    }

    const querySignature = this.buildQueryNameSignature(query);
    const consumed = new Set<number>();
    const resolved: DiscoveryResponseCandidate[] = [];

    for (const [index, item] of items.entries()) {
      if (consumed.has(index)) {
        continue;
      }

      if (!this.isSparseQueryVariantCandidate(item)) {
        resolved.push(item);
        continue;
      }

      const matches = items
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate, candidateIndex }) =>
            candidateIndex !== index &&
            !consumed.has(candidateIndex) &&
            this.isRicherQueryVariantCandidate(candidate) &&
            this.hasRichFullNameMatchForQuery(querySignature, candidate) &&
            (
              this.hasQuerySurnameVariantMatch(item, candidate) ||
              this.hasExactLongNameSparseDuplicate(item, candidate)
            ),
        );

      if (matches.length === 1) {
        const [{ candidate, candidateIndex }] = matches;
        consumed.add(index);
        consumed.add(candidateIndex);
        resolved.push(this.mergeResponseCandidatePair(candidate, item));
        continue;
      }

      resolved.push(item);
    }

    for (const [index, item] of items.entries()) {
      if (!consumed.has(index) && !resolved.includes(item)) {
        resolved.push(item);
      }
    }

    const complementaryResolved =
      this.collapseComplementaryExactLongNameDuplicates(resolved);

    return complementaryResolved.sort(
      (a, b) =>
        this.responseRankingScore(b) - this.responseRankingScore(a) ||
        b.score - a.score,
    );
  }

  private collapseComplementaryExactLongNameDuplicates(
    items: DiscoveryResponseCandidate[],
  ) {
    if (items.length < 2) {
      return items;
    }

    const consumed = new Set<number>();
    const resolved: DiscoveryResponseCandidate[] = [];

    for (const [index, item] of items.entries()) {
      if (consumed.has(index)) {
        continue;
      }

      const matches = items
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate, candidateIndex }) =>
            candidateIndex !== index &&
            !consumed.has(candidateIndex) &&
            this.hasExactLongNameComplementaryDuplicate(item, candidate),
        );

      if (matches.length === 1) {
        const [{ candidate, candidateIndex }] = matches;
        const [primary, secondary] =
          this.responseRankingScore(item) >= this.responseRankingScore(candidate)
            ? [item, candidate]
            : [candidate, item];
        consumed.add(index);
        consumed.add(candidateIndex);
        resolved.push(this.mergeResponseCandidatePair(primary, secondary));
        continue;
      }

      resolved.push(item);
    }

    for (const [index, item] of items.entries()) {
      if (!consumed.has(index) && !resolved.includes(item)) {
        resolved.push(item);
      }
    }

    return resolved;
  }

  private mergeResponseCandidates(items: DiscoveryResponseCandidate[]) {
    const map = new Map<string, DiscoveryResponseCandidate>();
    let fallbackCounter = 0;

    for (const item of items) {
      const key =
        this.findResponseMergeKey(map, item) ??
        this.primaryProfileKey(item) ??
        `${item.normalizedName}:${fallbackCounter++}`;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, this.cloneResponseCandidate(item));
        continue;
      }
      map.set(key, this.mergeResponseCandidatePair(existing, item));
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        this.responseRankingScore(b) - this.responseRankingScore(a) ||
        b.score - a.score,
    );
  }

  private responseRankingScore(item: DiscoveryResponseCandidate) {
    return Math.max(item.score ?? 0, Math.round((item.dbMatchScore ?? 0) * 100));
  }

  private mergeResponseCandidatePair(
    existing: DiscoveryResponseCandidate,
    item: DiscoveryResponseCandidate,
  ) {
    const mergedProfiles = [...existing.sourceProfiles];
    for (const profile of item.sourceProfiles) {
      const exists = mergedProfiles.some(
        (x) =>
          x.platform === profile.platform &&
          x.externalAuthorId === profile.externalAuthorId,
      );
      if (!exists) {
        mergedProfiles.push(profile);
      }
    }

    const mergedAffiliations = this.mergeAffiliations(
      existing.affiliations,
      item.affiliations,
    );
    const mergedAffiliationRaw = [
      ...existing.affiliationRaw,
      ...item.affiliationRaw,
    ].filter(Boolean);
    const canonicalIdentity = this.pickPreferredCanonicalIdentity(
      existing,
      item,
    );
    const preferredMeta = this.pickPreferredResponseMetadata(existing, item);
    const canonicalMeta = this.pickCanonicalResponseMetadata(
      existing,
      item,
      canonicalIdentity,
    );

    return this.applyInstitutionIdentity({
      ...existing,
      ...(canonicalMeta ?? preferredMeta),
      displayName: canonicalIdentity.displayName,
      normalizedName: canonicalIdentity.normalizedName,
      affiliations: mergedAffiliations,
      affiliationRaw: [...new Set(mergedAffiliationRaw)],
      searchIndex: this.mergeSearchIndex(existing.searchIndex, item.searchIndex),
      sourceProfiles: mergedProfiles,
      score: Math.max(existing.score, item.score),
      dbMatchScore: Math.max(existing.dbMatchScore ?? 0, item.dbMatchScore ?? 0),
    });
  }

  private findResponseMergeKey(
    map: Map<string, DiscoveryResponseCandidate>,
    incoming: DiscoveryResponseCandidate,
  ) {
    for (const [key, existing] of map.entries()) {
      const identityMatch = this.calculateIdentityMatch(existing, incoming);
      if (identityMatch.shouldMerge) {
        return key;
      }
    }

    return null;
  }

  private cloneResponseCandidate(item: DiscoveryResponseCandidate) {
    return this.applyInstitutionIdentity({
      ...item,
      affiliations: [...item.affiliations],
      affiliationRaw: [...item.affiliationRaw],
      searchIndex: {
        ...item.searchIndex,
        keywords: [...item.searchIndex.keywords],
        institutionAliases: [...item.searchIndex.institutionAliases],
      },
      sourceProfiles: item.sourceProfiles.map((profile) => ({ ...profile })),
    });
  }

  private pickPreferredResponseMetadata(
    left: DiscoveryResponseCandidate,
    right: DiscoveryResponseCandidate,
  ) {
    const leftRank =
      (left.dbMatchScore ?? 0) * 1000 +
      this.scoreCanonicalIdentity(left) +
      left.sourceProfiles.length * 5 +
      left.score;
    const rightRank =
      (right.dbMatchScore ?? 0) * 1000 +
      this.scoreCanonicalIdentity(right) +
      right.sourceProfiles.length * 5 +
      right.score;

    const preferred = rightRank > leftRank ? right : left;
    return {
      dbAuthorId: preferred.dbAuthorId,
      dbStatus: preferred.dbStatus,
    };
  }

  private pickCanonicalResponseMetadata(
    left: DiscoveryResponseCandidate,
    right: DiscoveryResponseCandidate,
    canonicalIdentity: {
      displayName: string;
      normalizedName: string;
    },
  ) {
    const matchesCanonical = (item: DiscoveryResponseCandidate) =>
      item.displayName === canonicalIdentity.displayName &&
      item.normalizedName === canonicalIdentity.normalizedName;

    if (matchesCanonical(left) && !matchesCanonical(right)) {
      return {
        dbAuthorId: left.dbAuthorId,
        dbStatus: left.dbStatus,
      };
    }

    if (matchesCanonical(right) && !matchesCanonical(left)) {
      return {
        dbAuthorId: right.dbAuthorId,
        dbStatus: right.dbStatus,
      };
    }

    return null;
  }

  private findMergeKey(
    map: Map<string, UnifiedAuthorCandidate>,
    incoming: UnifiedAuthorCandidate,
  ) {
    for (const [key, existing] of map.entries()) {
      const identityMatch = this.calculateIdentityMatch(existing, incoming);
      if (identityMatch.shouldMerge) {
        return key;
      }
    }

    return null;
  }

  private calculateIdentityMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ): IdentityMatchResult {
    if (this.hasStablePlatformProfileConflict(left, right)) {
      return { score: 0, shouldMerge: false };
    }

    const leftProfileKeys = left.sourceProfiles.map(
      (p) => `${p.platform}:${p.externalAuthorId}`,
    );
    const rightProfileKeys = right.sourceProfiles.map(
      (p) => `${p.platform}:${p.externalAuthorId}`,
    );
    const sharedProfileMatch = leftProfileKeys.some((profileKey) =>
      rightProfileKeys.includes(profileKey),
    );

    if (sharedProfileMatch) {
      return { score: 1, shouldMerge: true };
    }

    const pubmedAbbreviationMatch = this.hasPubmedAbbreviationMatch(left, right);
    const pubmedExpandedNameMatch = this.hasPubmedExpandedNameMatch(
      left,
      right,
    );
    const clarivateAbbreviationMatch = this.hasClarivateAbbreviationMatch(
      left,
      right,
    );
    const nameSimilarity = this.nameSimilarity(
      left.normalizedName,
      right.normalizedName,
    );
    const exactNameMatch = left.normalizedName === right.normalizedName;
    const affiliationMatch = this.hasAffiliationOverlap(left, right);
    const emailDomainMatch = this.hasEmailDomainMatch(left, right);
    const emailDomainConflict = this.hasDifferentKnownEmailDomain(left, right);
    const hasAnyCommonPlatform = this.hasCommonPlatform(left, right);
    const locationMatch = this.hasLocationMatch(
      left,
      right,
      hasAnyCommonPlatform,
    );
    const institutionMatch = this.hasInstitutionMatch(left, right);
    const institutionConflict = this.hasDifferentKnownInstitution(left, right);
    const strongTokenNameMatch = this.hasStrongTokenNameMatch(
      left.normalizedName,
      right.normalizedName,
    );
    const subsetNameMatch = this.hasNameSubsetMatch(
      left.normalizedName,
      right.normalizedName,
    );
    const sourceNoiseNameMatch =
      exactNameMatch &&
      (this.hasDisplayNameSourceNoise(left.displayName) ||
        this.hasDisplayNameSourceNoise(right.displayName));
    const minimalNameEvidence =
      pubmedAbbreviationMatch ||
      pubmedExpandedNameMatch ||
      clarivateAbbreviationMatch ||
      subsetNameMatch ||
      strongTokenNameMatch ||
      nameSimilarity >= 0.72;
    const trdizinCityConflict =
      this.hasCommonPlatform(left, right, 'trdizin') &&
      this.hasDifferentKnownCity(left, right);
    const exactNameCorroboration =
      affiliationMatch ||
      institutionMatch ||
      emailDomainMatch ||
      locationMatch ||
      sourceNoiseNameMatch ||
      clarivateAbbreviationMatch ||
      pubmedAbbreviationMatch ||
      pubmedExpandedNameMatch;

    if (!minimalNameEvidence) {
      return { score: 0, shouldMerge: false };
    }

    if (exactNameMatch && !exactNameCorroboration) {
      return { score: 0, shouldMerge: false };
    }

    if (
      exactNameMatch &&
      institutionConflict &&
      !sourceNoiseNameMatch &&
      !(emailDomainMatch || affiliationMatch)
    ) {
      return { score: 0, shouldMerge: false };
    }

    if (
      exactNameMatch &&
      emailDomainConflict &&
      !sourceNoiseNameMatch &&
      !(institutionMatch || affiliationMatch)
    ) {
      return { score: 0, shouldMerge: false };
    }

    if (
      !exactNameMatch &&
      institutionConflict &&
      !(
        pubmedAbbreviationMatch ||
        pubmedExpandedNameMatch ||
        emailDomainMatch ||
        affiliationMatch
      )
    ) {
      return { score: 0, shouldMerge: false };
    }

    if (
      !exactNameMatch &&
      emailDomainConflict &&
      !(
        pubmedAbbreviationMatch ||
        pubmedExpandedNameMatch ||
        institutionMatch ||
        affiliationMatch
      )
    ) {
      return { score: 0, shouldMerge: false };
    }

    if (
      trdizinCityConflict &&
      !(
        affiliationMatch ||
        institutionMatch ||
        emailDomainMatch ||
        subsetNameMatch
      )
    ) {
      return { score: 0, shouldMerge: false };
    }

    let score = 0;

    if (pubmedAbbreviationMatch) {
      score += 0.72;
    }
    if (pubmedExpandedNameMatch) {
      score += 0.72;
    }
    if (clarivateAbbreviationMatch) {
      score += 0.55;
    }
    if (subsetNameMatch) {
      score += 0.45;
    }
    if (strongTokenNameMatch) {
      score += 0.4;
    }
    if (nameSimilarity >= 0.95) {
      score += 0.35;
    } else if (nameSimilarity >= 0.88) {
      score += 0.3;
    } else if (nameSimilarity >= 0.72) {
      score += 0.2;
    }
    if (affiliationMatch) {
      score += 0.25;
    }
    if (institutionMatch) {
      score += 0.2;
    }
    if (emailDomainMatch) {
      score += 0.18;
    }
    if (locationMatch) {
      score += 0.12;
    }

    return {
      score: Math.min(score, 1),
      shouldMerge: score >= AUTHOR_IDENTITY_MATCH_THRESHOLD,
    };
  }

  private hasStablePlatformProfileConflict(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const leftProfiles = this.collectStablePlatformProfileIds(left.sourceProfiles);
    const rightProfiles = this.collectStablePlatformProfileIds(right.sourceProfiles);

    for (const [platform, leftIds] of leftProfiles.entries()) {
      const rightIds = rightProfiles.get(platform);
      if (!rightIds || rightIds.size === 0) {
        continue;
      }

      const shared = Array.from(leftIds).some((id) => rightIds.has(id));
      if (!shared) {
        return true;
      }
    }

    return false;
  }

  private collectStablePlatformProfileIds(
    profiles: UnifiedAuthorCandidate['sourceProfiles'],
  ) {
    const map = new Map<string, Set<string>>();

    for (const profile of profiles ?? []) {
      const platform = this.normalizeStableAuthorPlatform(profile.platform);
      const externalAuthorId = profile.externalAuthorId?.trim();
      if (
        !platform ||
        !externalAuthorId ||
        !SINGLE_AUTHOR_PROFILE_PLATFORMS.has(platform)
      ) {
        continue;
      }

      const current = map.get(platform) ?? new Set<string>();
      current.add(externalAuthorId);
      map.set(platform, current);
    }

    return map;
  }

  private normalizeStableAuthorPlatform(platform?: string | null) {
    const normalized = platform?.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === 'google_scholar') {
      return 'serpapi_scholar';
    }
    if (normalized === 'scopus_scraper') {
      return 'scraper_scopus';
    }

    return normalized;
  }

  private pickPreferredCanonicalIdentity(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    return this.scoreCanonicalIdentity(left) >= this.scoreCanonicalIdentity(right)
      ? {
          displayName: left.displayName,
          normalizedName: left.normalizedName,
        }
      : {
          displayName: right.displayName,
          normalizedName: right.normalizedName,
        };
  }

  private scoreCanonicalIdentity(item: UnifiedAuthorCandidate) {
    const displayName = item.displayName?.trim() ?? '';
    if (!displayName || displayName.toLowerCase() === 'unknown') {
      return 0;
    }

    const normalizedName = this.normalizePersonName(displayName);
    const tokens = this.nameTokensOrdered(normalizedName);
    const longTokenCount = tokens.filter((token) => token.length > 2).length;
    const isPubmedAbbreviation = !!this.parsePubmedNameSignature(normalizedName);
    const hasSourceNoise =
      /\b(google scholar|google akademik|scholar|akademik|citations?)\b/i.test(
        displayName,
      );

    return (
      tokens.length * 20 +
      longTokenCount * 10 +
      Math.min(displayName.length, 48) / 4 +
      (/[çğıöşüÇĞİÖŞÜ]/.test(displayName) ? 6 : 0) +
      (/^[A-ZÇĞİÖŞÜ]/.test(displayName) ? 8 : 0) -
      (isPubmedAbbreviation ? 40 : 0) -
      (hasSourceNoise ? 45 : 0)
    );
  }

  private primaryProfileKey(item: UnifiedAuthorCandidate) {
    const profile = item.sourceProfiles[0];
    if (!profile) {
      return null;
    }
    return `${profile.platform}:${profile.externalAuthorId}`;
  }

  private mapSerpapiAuthor(author: {
    name: string | null;
    normalizedName: string;
    affiliation: string | null;
    author_id: string;
    score: number;
  }): UnifiedAuthorCandidate {
    const rawAffiliation = author.affiliation?.trim() ?? '';
    const parsedAffiliation = rawAffiliation
      ? [this.parseAffiliation(rawAffiliation, 'serpapi_scholar')]
      : [];

    const searchIndex = this.buildSearchIndex(
      author.name ?? '',
      author.normalizedName,
      parsedAffiliation,
    );

    return this.applyInstitutionIdentity({
      displayName: author.name ?? 'Unknown',
      normalizedName: this.normalizePersonName(
        author.name ?? author.normalizedName,
      ),
      affiliations: parsedAffiliation,
      affiliationRaw: rawAffiliation ? [rawAffiliation] : [],
      searchIndex,
      sourceProfiles: [
        {
          platform: 'serpapi_scholar',
          externalAuthorId: author.author_id,
          profileUrl: `https://scholar.google.com/citations?user=${author.author_id}`,
          score: author.score,
        },
      ],
      score: author.score ?? 0,
    });
  }

  private mapTrdizinAuthor(author: {
    authorId: string;
    displayName: string;
    normalizedName: string;
    affiliations?: string[];
    score: number;
  }): UnifiedAuthorCandidate {
    const rawAffiliations = author.affiliations ?? [];
    const parsedAffiliations = rawAffiliations.map((raw) =>
      this.parseAffiliation(raw, 'trdizin'),
    );

    const searchIndex = this.buildSearchIndex(
      author.displayName,
      this.normalizeForSearch(author.displayName || author.normalizedName),
      parsedAffiliations,
    );

    return this.applyInstitutionIdentity({
      displayName: author.displayName,
      normalizedName: this.normalizePersonName(
        author.displayName || author.normalizedName,
      ),
      affiliations: parsedAffiliations,
      affiliationRaw: rawAffiliations,
      searchIndex,
      sourceProfiles: [
        {
          platform: 'trdizin',
          externalAuthorId: author.authorId,
          profileUrl: `https://search.trdizin.gov.tr/tr/yayin/ara?q=${encodeURIComponent(author.displayName)}`,
          score: author.score,
        },
      ],
      score: author.score ?? 0,
    });
  }

  private mapClarivateAuthor(
    author: {
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
      documentCount: number;
    },
    affiliations: string[],
  ): UnifiedAuthorCandidate {
    const rawAffiliations = affiliations
      .map((item) => item.trim())
      .filter(Boolean);
    const parsedAffiliations = rawAffiliations.map((raw) =>
      this.parseAffiliation(raw, 'clarivate_wos'),
    );
    const normalizedName = this.normalizeClarivatePersonName(author.displayName);
    const searchIndex = this.buildSearchIndex(
      author.displayName,
      normalizedName,
      parsedAffiliations,
    );

    return this.applyInstitutionIdentity({
      displayName: author.displayName,
      normalizedName,
      affiliations: parsedAffiliations,
      affiliationRaw: rawAffiliations,
      searchIndex,
      sourceProfiles: [
        {
          platform: 'clarivate_wos',
          externalAuthorId:
            author.researcherId || author.wosStandard || normalizedName,
          score: author.documentCount,
        },
      ],
      score: author.documentCount ?? 0,
    });
  }

  private mapClarivateCandidates(
    query: string,
    result: Record<string, unknown>,
    limit: number,
  ) {
    const mapped = new Map<string, UnifiedAuthorCandidate>();
    const maxCandidates = Math.max(3, Math.min(limit, 8));

    const pushAuthor = (
      author: {
        displayName: string;
        wosStandard?: string;
        researcherId?: string;
        documentCount: number;
      } | null,
      affiliations: string[],
    ) => {
      if (!author?.displayName?.trim()) {
        return;
      }

      const candidate = this.mapClarivateAuthor(author, affiliations);
      const queryMatch = this.scoreNameAgainstQuery(
        this.buildQueryNameSignature(query),
        candidate.displayName,
        candidate.searchIndex.keywords,
      );

      if (queryMatch.score <= 0) {
        return;
      }

      const primaryProfile =
        candidate.sourceProfiles[0]?.externalAuthorId?.trim() ||
        `${candidate.displayName}|${candidate.normalizedName}`;
      if (!mapped.has(primaryProfile)) {
        mapped.set(primaryProfile, candidate);
      }
    };

    const selectedAuthor =
      result.author && typeof result.author === 'object'
        ? (result.author as {
            displayName: string;
            wosStandard?: string;
            researcherId?: string;
            documentCount: number;
          })
        : null;
    pushAuthor(selectedAuthor, this.readStringArray(result, 'affiliations'));

    const candidates = Array.isArray(result.candidates)
      ? result.candidates.slice(0, maxCandidates)
      : [];

    for (const item of candidates) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const candidateObject = item as Record<string, unknown>;
      pushAuthor(
        {
          displayName: this.readString(candidateObject, 'displayName') ?? '',
          wosStandard: this.readString(candidateObject, 'wosStandard') ?? undefined,
          researcherId:
            this.readString(candidateObject, 'researcherId') ?? undefined,
          documentCount: Number(
            this.readString(candidateObject, 'documentCount') ?? '0',
          ),
        },
        this.readStringArray(candidateObject, 'affiliations'),
      );
    }

    return Array.from(mapped.values());
  }

  private mapScopusScraperAuthor(author: {
    authorName: string;
    normalizedName: string;
    authorId?: string | null;
    authorProfileUrl?: string;
    documents?: number | null;
    affiliation?: string | null;
    city?: string | null;
    country?: string | null;
    score: number;
  }): UnifiedAuthorCandidate {
    const rawAffiliation = author.affiliation?.trim() ?? '';
    const parsedAffiliations = rawAffiliation
      ? [this.parseAffiliation(rawAffiliation, 'scraper_scopus')]
      : [];

    const fallbackCity = author.city?.trim();
    const fallbackCountry = author.country?.trim();

    const baseSearchIndex = this.buildSearchIndex(
      author.authorName,
      this.normalizePersonName(author.authorName || author.normalizedName),
      parsedAffiliations,
    );

    const searchIndex = {
      ...baseSearchIndex,
      city: baseSearchIndex.city ?? fallbackCity,
      country: baseSearchIndex.country ?? fallbackCountry,
    };

    const externalAuthorId =
      author.authorId ||
      this.extractQueryParam(author.authorProfileUrl, 'authorId') ||
      this.extractQueryParam(author.authorProfileUrl, 'authorID') ||
      author.normalizedName;

    return this.applyInstitutionIdentity({
      displayName: author.authorName,
      normalizedName: this.normalizePersonName(
        author.authorName || author.normalizedName,
      ),
      affiliations: parsedAffiliations,
      affiliationRaw: rawAffiliation ? [rawAffiliation] : [],
      searchIndex,
      sourceProfiles: [
        {
          platform: 'scraper_scopus',
          externalAuthorId,
          profileUrl: author.authorProfileUrl,
          score: author.score,
        },
      ],
      score: author.score ?? 0,
    });
  }

  private mapPubmedScraperAuthors(
    query: string,
    result: {
      nameParts?: { firstName?: string; lastName?: string };
      matchedArticles?: Array<{
        authors: string | null;
        score?: number;
        detail?: {
          authorDetails?: Array<{
            fullName?: string;
            affiliations?: string[];
          }>;
        } | null;
      }>;
    },
  ) {
    const extracted = this.extractPubmedAuthorCandidates(
      query,
      result.nameParts,
      result.matchedArticles ?? [],
    );

    if (extracted.length > 0) {
      return extracted;
    }

    // Fallback: if PubMed has matches but author tokens are not cleanly parseable.
    if ((result.matchedArticles ?? []).length > 0) {
      const normalizedName = this.normalizePersonName(query);
      return [
        this.applyInstitutionIdentity({
          displayName: query,
          normalizedName,
          affiliations: [],
          affiliationRaw: [],
          searchIndex: this.buildSearchIndex(query, normalizedName, []),
          sourceProfiles: [
            {
              platform: 'scraper_pubmed',
              externalAuthorId: normalizedName || this.normalizeForSearch(query),
              profileUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`,
              score: Math.min((result.matchedArticles ?? []).length, 20),
            },
          ],
          score: Math.min((result.matchedArticles ?? []).length, 20),
        }),
      ];
    }

    return [];
  }

  private parseAffiliation(raw: string, platform?: string): ParsedAffiliation {
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    const emailDomainMatch = cleaned.match(
      /verified email at ([a-z0-9.-]+\.[a-z]{2,})/i,
    );
    const fallbackDomainMatch = cleaned.match(
      /\b([a-z0-9.-]+\.(edu|ac|gov|org|net|com|tr))\b/i,
    );
    const emailDomain = (
      emailDomainMatch?.[1] ?? fallbackDomainMatch?.[1]
    )?.toLowerCase();

    const personTitle = this.firstMatch(cleaned, [
      /\b(prof\.?|dr\.?|assoc\.?\s*prof\.?|asst\.?\s*prof\.?)\b/i,
    ]);
    const role = this.firstMatch(cleaned, [
      /\b(asst\.?\s*prof\.?|assoc\.?\s*prof\.?|professor|research(er| assistant)?)\b/i,
    ]);
    const department = this.firstMatch(cleaned, [
      /dept\.?\s*of\s*([^,]+)/i,
      /department of\s*([^,]+)/i,
      /b[öo]l[üu]m[üu]\s*([^,]+)/i,
    ]);
    const faculty = this.firstMatch(cleaned, [
      /faculty of\s*([^,]+)/i,
      /fak[üu]ltesi\s*([^,]+)/i,
    ]);
    const university =
      extractInstitutionNameCandidate(
        this.firstMatch(cleaned, [
          /([a-zçğıöşü\s]+ university)/i,
          /([a-zçğıöşü\s]+ universitesi)/i,
          /([a-zçğıöşü\s]+ üniversitesi)/i,
          /([a-zçğıöşü\s]+ ün\.)/i,
        ]) ?? cleaned,
      ) ?? undefined;
    const country = this.firstMatch(cleaned, [
      /\b(turkey|türkiye|turkiye|usa|united states|germany|france|uk)\b/i,
    ]);

    // Heuristic city extraction (works reasonably for common formats).
    const city = this.firstMatch(cleaned, [
      /,\s*([A-ZÇĞİÖŞÜ][a-zçğıöşü]+)\s*,\s*(Turkey|Türkiye|Turkiye|USA|United States)\b/i,
    ]);

    const tokens = this.normalizeForSearch(
      `${cleaned} ${personTitle ?? ''} ${role ?? ''} ${department ?? ''} ${faculty ?? ''} ${university ?? ''} ${city ?? ''} ${country ?? ''} ${emailDomain ?? ''}`,
    )
      .split(' ')
      .filter(Boolean);

    this.logger.debug(
      `Affiliation parsed raw="${raw}" university="${university ?? ''}" city="${city ?? ''}" country="${country ?? ''}" emailDomain="${emailDomain ?? ''}"`,
    );

    return {
      raw: cleaned,
      platform: platform?.trim() || undefined,
      personTitle: personTitle ?? undefined,
      role: role ?? undefined,
      department: department ?? undefined,
      faculty: faculty ?? undefined,
      university: university ?? undefined,
      city: city ?? undefined,
      country: country ?? undefined,
      emailDomain,
      tokens: [...new Set(tokens)],
    };
  }

  private buildSearchIndex(
    displayName: string,
    normalizedName: string,
    affiliations: ParsedAffiliation[],
  ) {
    const firstAff = affiliations[0];
    const keywords = new Set<string>();

    for (const token of this.normalizeForSearch(displayName).split(' ')) {
      if (token) keywords.add(token);
    }
    for (const token of normalizedName.split(' ')) {
      if (token) keywords.add(token);
    }
    for (const aff of affiliations) {
      for (const token of aff.tokens) {
        if (token) keywords.add(token);
      }
    }

    return {
      keywords: Array.from(keywords),
      university: firstAff?.university,
      institutionKey: firstAff?.institutionCanonicalKey,
      institutionAliases: [],
      city: firstAff?.city,
      country: firstAff?.country,
      emailDomain: firstAff?.emailDomain,
    };
  }

  private mergeAffiliations(
    left: ParsedAffiliation[],
    right: ParsedAffiliation[],
  ): ParsedAffiliation[] {
    const map = new Map<string, ParsedAffiliation>();
    for (const item of [...left, ...right]) {
      if (!map.has(item.raw)) {
        map.set(item.raw, item);
      }
    }
    return Array.from(map.values());
  }

  private mergeSearchIndex(
    left: UnifiedAuthorCandidate['searchIndex'],
    right: UnifiedAuthorCandidate['searchIndex'],
  ) {
    return {
      keywords: [...new Set([...(left.keywords ?? []), ...(right.keywords ?? [])])],
      university: left.university ?? right.university,
      institutionKey: left.institutionKey ?? right.institutionKey,
      institutionAliases: [
        ...new Set([
          ...(left.institutionAliases ?? []),
          ...(right.institutionAliases ?? []),
        ]),
      ],
      city: left.city ?? right.city,
      country: left.country ?? right.country,
      emailDomain: left.emailDomain ?? right.emailDomain,
    };
  }

  private normalizeForSearch(value: string) {
    return value
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/İ/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildQueryNameSignature(query: string): QueryNameSignature {
    const normalizedQuery = this.normalizePersonName(query);
    const tokens = [...new Set(this.nameTokensForSignature(normalizedQuery))];
    const surname = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
    const givenTokens = surname ? tokens.slice(0, -1) : [];
    const compactInitials = givenTokens
      .map((token) => token[0])
      .filter(Boolean)
      .join('');

    return {
      normalizedQuery,
      tokens,
      surname,
      givenTokens,
      compactInitials: compactInitials || undefined,
    };
  }

  private pickBestQueryNameMatch(
    querySignature: QueryNameSignature,
    nameVariants: string[],
    candidateKeywords: string[] = [],
  ) {
    let best: QueryNameMatchResult | null = null;

    for (const value of nameVariants) {
      const match = this.scoreNameAgainstQuery(
        querySignature,
        value,
        candidateKeywords,
      );

      if (!best || match.score > best.score) {
        best = match;
      }
    }

    return best;
  }

  private scoreNameAgainstQuery(
    querySignature: QueryNameSignature,
    candidateName: string,
    candidateKeywords: string[] = [],
  ): QueryNameMatchResult {
    const normalizedCandidate = this.normalizePersonName(candidateName);
    const candidateTokens = this.nameTokensForSignature(normalizedCandidate);

    if (
      !querySignature.normalizedQuery ||
      querySignature.tokens.length === 0 ||
      candidateTokens.length === 0
    ) {
      return {
        score: 0,
        exact: false,
        initialsMatch: false,
        subset: false,
        surnameMatch: false,
      };
    }

    const exact = normalizedCandidate === querySignature.normalizedQuery;
    const subset = this.hasNameSubsetMatch(
      querySignature.normalizedQuery,
      normalizedCandidate,
    );
    const similarity = this.nameSimilarity(
      querySignature.normalizedQuery,
      normalizedCandidate,
    );
    const candidateTokenSet = new Set(candidateTokens);
    const surnameMatch = querySignature.surname
      ? candidateTokenSet.has(querySignature.surname)
      : false;

    if (querySignature.surname && !surnameMatch) {
      return {
        score: 0,
        exact,
        initialsMatch: false,
        subset,
        surnameMatch: false,
      };
    }

    const givenMatchCount = querySignature.givenTokens.reduce(
      (count, token) => count + (candidateTokenSet.has(token) ? 1 : 0),
      0,
    );
    const givenCoverage =
      querySignature.givenTokens.length > 0
        ? givenMatchCount / querySignature.givenTokens.length
        : 0;

    const initialsMatch = this.hasQueryInitialsMatch(
      querySignature,
      normalizedCandidate,
      candidateKeywords,
    );
    const extraTokenCount = Math.max(
      0,
      candidateTokens.length - querySignature.tokens.length,
    );
    const extraTokenPenalty =
      !subset && extraTokenCount > 0 ? Math.min(0.18, extraTokenCount * 0.12) : 0;

    if (exact) {
      return {
        score: 1,
        exact: true,
        initialsMatch,
        subset,
        surnameMatch: true,
      };
    }

    let score =
      (surnameMatch ? 0.45 : 0) + givenCoverage * 0.3 + similarity * 0.25;

    if (subset) {
      score += 0.08;
    }
    if (initialsMatch) {
      score += 0.24;
    }

    score = Math.max(0, Math.min(1, score - extraTokenPenalty));

    return {
      score,
      exact: false,
      initialsMatch,
      subset,
      surnameMatch,
    };
  }

  private hasQueryInitialsMatch(
    querySignature: QueryNameSignature,
    normalizedCandidate: string,
    candidateKeywords: string[] = [],
  ) {
    if (!querySignature.surname || !querySignature.compactInitials) {
      return false;
    }

    const normalizedKeywords = new Set(
      candidateKeywords.map((keyword) => this.normalizeForSearch(keyword)),
    );
    if (
      normalizedKeywords.has(querySignature.surname) &&
      normalizedKeywords.has(querySignature.compactInitials)
    ) {
      return true;
    }

    const pubmedSignature = this.parsePubmedNameSignature(normalizedCandidate);
    if (
      pubmedSignature &&
      pubmedSignature.lastName === querySignature.surname &&
      this.areInitialsCompatible(
        querySignature.compactInitials,
        pubmedSignature.initials,
        pubmedSignature.givenTokens,
        { allowSingleInitialTokenMatch: true },
      )
    ) {
      return true;
    }

    const regularSignature = this.parseRegularNameSignature(normalizedCandidate);
    if (
      regularSignature &&
      regularSignature.lastName === querySignature.surname &&
      this.areInitialsCompatible(
        querySignature.compactInitials,
        regularSignature.initials,
        regularSignature.givenTokens,
        { allowSingleInitialTokenMatch: true },
      )
    ) {
      return true;
    }

    return false;
  }

  private nameSimilarity(a: string, b: string) {
    const aTokens = new Set(a.split(' ').filter(Boolean));
    const bTokens = new Set(b.split(' ').filter(Boolean));
    if (aTokens.size === 0 || bTokens.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) {
        intersection += 1;
      }
    }
    const union = new Set([...aTokens, ...bTokens]).size;
    return intersection / union;
  }

  private hasAffiliationOverlap(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const weakTokens = new Set([
      'university',
      'universitesi',
      'universite',
      'faculty',
      'fakultesi',
      'department',
      'dept',
      'bolumu',
      'turkiye',
      'turkey',
      've',
      'of',
      'the',
      'dr',
      'prof',
    ]);
    const leftTokens = new Set(
      left.searchIndex.keywords.filter(
        (token) => token.length > 2 && !weakTokens.has(token),
      ),
    );
    const rightTokens = new Set(
      right.searchIndex.keywords.filter(
        (token) => token.length > 2 && !weakTokens.has(token),
      ),
    );
    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const minSize = Math.min(leftTokens.size, rightTokens.size);
    if (union === 0 || minSize === 0) {
      return false;
    }

    const jaccard = overlap / union;
    const coverage = overlap / minSize;
    return overlap >= 4 && (jaccard >= 0.18 || coverage >= 0.45);
  }

  private hasStrongTokenNameMatch(a: string, b: string) {
    const aTokens = new Set(
      a
        .split(' ')
        .filter(
          (token) =>
            token && !AUTHOR_NAME_NOISE_TOKENS.has(token) && token.length > 1,
        ),
    );
    const bTokens = new Set(
      b
        .split(' ')
        .filter(
          (token) =>
            token && !AUTHOR_NAME_NOISE_TOKENS.has(token) && token.length > 1,
        ),
    );

    if (aTokens.size === 0 || bTokens.size === 0) {
      return false;
    }

    let intersection = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) {
        intersection += 1;
      }
    }

    if (intersection < 2) {
      return false;
    }

    const minSetSize = Math.min(aTokens.size, bTokens.size);
    const maxSetSize = Math.max(aTokens.size, bTokens.size);

    // Avoid merging broad 2-token names like "kemal yilmaz" with longer names.
    if (intersection === 2 && maxSetSize >= 3) {
      return false;
    }

    return intersection >= minSetSize;
  }

  private hasNameSubsetMatch(a: string, b: string) {
    const aOrdered = this.nameTokensOrdered(a);
    const bOrdered = this.nameTokensOrdered(b);
    const aTokens = new Set(aOrdered);
    const bTokens = new Set(bOrdered);

    if (aOrdered.length < 2 || bOrdered.length < 2) {
      return false;
    }

    const smallTokens = aTokens.size <= bTokens.size ? aTokens : bTokens;
    const largeTokens = aTokens.size <= bTokens.size ? bTokens : aTokens;
    const smallOrdered = aOrdered.length <= bOrdered.length ? aOrdered : bOrdered;
    const largeOrdered = aOrdered.length <= bOrdered.length ? bOrdered : aOrdered;

    for (const token of smallTokens) {
      if (!largeTokens.has(token)) {
        return false;
      }
    }

    // "yilmaz yuce" subset matches "yilmaz kemal yuce", but
    // "kemal yilmaz" should not match "yilmaz kemal yuce".
    if (smallOrdered.length === 2 && largeOrdered.length >= 3) {
      const [s1, s2] = smallOrdered;
      const first = largeOrdered[0];
      const last = largeOrdered[largeOrdered.length - 1];
      const boundaryMatch =
        (s1 === first && s2 === last) || (s1 === last && s2 === first);
      if (!boundaryMatch) {
        return false;
      }
    }

    return true;
  }

  private normalizePersonName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const normalizedCommaAware = trimmed.includes(',')
      ? (() => {
          const [left, right] = trimmed.split(',').map((x) => x.trim());
          if (!left || !right) {
            return trimmed;
          }
          return `${right} ${left}`;
        })()
      : trimmed;

    return this.nameTokensOrdered(this.normalizeForSearch(normalizedCommaAware)).join(
      ' ',
    );
  }

  private normalizeClarivatePersonName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const normalizedCommaAware = trimmed.includes(',')
      ? (() => {
          const [left, right] = trimmed.split(',').map((x) => x.trim());
          if (!left || !right) {
            return trimmed;
          }
          return `${right} ${left}`;
        })()
      : trimmed;

    return this.nameTokensForSignature(
      this.normalizeForSearch(normalizedCommaAware),
    ).join(' ');
  }

  private nameTokensOrdered(value: string) {
    return value
      .split(' ')
      .map((token) => token.trim())
      .filter(
        (token) =>
          token && !AUTHOR_NAME_NOISE_TOKENS.has(token) && token.length > 1,
      );
  }

  private nameTokensForSignature(value: string) {
    return value
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token && !AUTHOR_NAME_NOISE_TOKENS.has(token));
  }

  private hasEmailDomainMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const leftDomain = left.searchIndex.emailDomain?.trim().toLowerCase();
    const rightDomain = right.searchIndex.emailDomain?.trim().toLowerCase();
    return Boolean(leftDomain && rightDomain && leftDomain === rightDomain);
  }

  private hasDifferentKnownEmailDomain(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const leftDomain = left.searchIndex.emailDomain?.trim().toLowerCase();
    const rightDomain = right.searchIndex.emailDomain?.trim().toLowerCase();

    if (!leftDomain || !rightDomain) {
      return false;
    }

    return leftDomain !== rightDomain;
  }

  private hasLocationMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
    enabled: boolean,
  ) {
    if (!enabled) {
      return false;
    }

    const leftCity = left.searchIndex.city
      ? this.normalizeForSearch(left.searchIndex.city)
      : null;
    const rightCity = right.searchIndex.city
      ? this.normalizeForSearch(right.searchIndex.city)
      : null;
    const leftCountry = left.searchIndex.country
      ? this.normalizeForSearch(left.searchIndex.country)
      : null;
    const rightCountry = right.searchIndex.country
      ? this.normalizeForSearch(right.searchIndex.country)
      : null;

    return Boolean(
      leftCity &&
        rightCity &&
        leftCountry &&
        rightCountry &&
        leftCity === rightCity &&
        leftCountry === rightCountry,
    );
  }

  private hasDifferentKnownCity(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const leftCity = left.searchIndex.city
      ? this.normalizeForSearch(left.searchIndex.city)
      : null;
    const rightCity = right.searchIndex.city
      ? this.normalizeForSearch(right.searchIndex.city)
      : null;

    if (!leftCity || !rightCity) {
      return false;
    }

    return leftCity !== rightCity;
  }

  private hasCommonPlatform(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
    platform?: string,
  ) {
    const leftPlatforms = new Set(left.sourceProfiles.map((x) => x.platform));
    const rightPlatforms = new Set(right.sourceProfiles.map((x) => x.platform));

    if (platform) {
      return leftPlatforms.has(platform) && rightPlatforms.has(platform);
    }

    for (const candidate of leftPlatforms) {
      if (rightPlatforms.has(candidate)) {
        return true;
      }
    }
    return false;
  }

  private hasPubmedAbbreviationMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const hasPubmedSide =
      this.hasPlatform(left, 'scraper_pubmed') ||
      this.hasPlatform(right, 'scraper_pubmed');
    if (!hasPubmedSide) {
      return false;
    }

    const leftPubmedSig = this.parsePubmedNameSignature(left.normalizedName);
    const rightPubmedSig = this.parsePubmedNameSignature(right.normalizedName);
    const leftRegularSig = this.parseRegularNameSignature(left.normalizedName);
    const rightRegularSig = this.parseRegularNameSignature(right.normalizedName);

    const combinations = [
      {
        pubmedSig: leftPubmedSig,
        otherSig: rightRegularSig,
        otherCandidate: right,
      },
      {
        pubmedSig: rightPubmedSig,
        otherSig: leftRegularSig,
        otherCandidate: left,
      },
      {
        pubmedSig: leftPubmedSig,
        otherSig: rightPubmedSig,
        otherCandidate: right,
      },
    ] as const;

    for (const { pubmedSig, otherSig, otherCandidate } of combinations) {
      if (!pubmedSig || !otherSig) {
        continue;
      }
      if (pubmedSig.lastName !== otherSig.lastName) {
        continue;
      }
      if (!pubmedSig.initials || !otherSig.initials) {
        continue;
      }
      if (
        this.areInitialsCompatible(
          pubmedSig.initials,
          otherSig.initials,
          otherSig.givenTokens,
          {
            allowSingleInitialTokenMatch: this.hasPlatform(
              otherCandidate,
              'scraper_pubmed',
            ),
          },
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private hasPubmedExpandedNameMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const hasPubmedSide =
      this.hasPlatform(left, 'scraper_pubmed') ||
      this.hasPlatform(right, 'scraper_pubmed');
    if (!hasPubmedSide) {
      return false;
    }

    const leftSig = this.parseRegularNameSignature(left.normalizedName);
    const rightSig = this.parseRegularNameSignature(right.normalizedName);
    if (!leftSig || !rightSig || leftSig.lastName !== rightSig.lastName) {
      return false;
    }

    const leftOrdered = [...leftSig.givenTokens, leftSig.lastName];
    const rightOrdered = [...rightSig.givenTokens, rightSig.lastName];
    const shorter = leftOrdered.length <= rightOrdered.length ? leftOrdered : rightOrdered;
    const longer = leftOrdered.length <= rightOrdered.length ? rightOrdered : leftOrdered;

    if (shorter.length < 2 || longer.length <= shorter.length) {
      return false;
    }

    const longerSuffix = longer.slice(longer.length - shorter.length);
    return shorter.every((token, index) => token === longerSuffix[index]);
  }

  private hasClarivateAbbreviationMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const hasClarivateSide =
      this.hasPlatform(left, 'clarivate_wos') ||
      this.hasPlatform(right, 'clarivate_wos');
    if (!hasClarivateSide) {
      return false;
    }

    const leftSig = this.extractClarivateComparableNameSignature(left);
    const rightSig = this.extractClarivateComparableNameSignature(right);
    if (!leftSig || !rightSig || leftSig.lastName !== rightSig.lastName) {
      return false;
    }

    return (
      this.matchesClarivateSignatureAgainstOther(left, right, leftSig, rightSig) ||
      this.matchesClarivateSignatureAgainstOther(right, left, rightSig, leftSig)
    );
  }

  private matchesClarivateSignatureAgainstOther(
    clarivateCandidate: UnifiedAuthorCandidate,
    otherCandidate: UnifiedAuthorCandidate,
    clarivateSig: {
      lastName: string;
      initials: string;
      givenTokens: string[];
    },
    otherSig: {
      lastName: string;
      initials: string;
      givenTokens: string[];
    },
  ) {
    if (!this.hasPlatform(clarivateCandidate, 'clarivate_wos')) {
      return false;
    }

    if (
      !this.areInitialsCompatible(
        clarivateSig.initials,
        otherSig.initials,
        otherSig.givenTokens,
        { allowSingleInitialTokenMatch: true },
      )
    ) {
      return false;
    }

    const preservedTokens = clarivateSig.givenTokens.filter(
      (token) => token.length > 1,
    );
    if (preservedTokens.length === 0) {
      return true;
    }

    const otherTokenSet = new Set(otherSig.givenTokens);
    return preservedTokens.every((token) => otherTokenSet.has(token));
  }

  private isClarivateAbbreviatedCandidate(item: UnifiedAuthorCandidate) {
    if (!this.hasPlatform(item, 'clarivate_wos')) {
      return false;
    }

    const signature = this.extractClarivateComparableNameSignature(item);
    return Boolean(
      signature && signature.givenTokens.some((token) => token.length === 1),
    );
  }

  private hasRichFullNameMatchForQuery(
    querySignature: QueryNameSignature,
    candidate: UnifiedAuthorCandidate,
  ) {
    const bestMatch = this.pickBestQueryNameMatch(
      querySignature,
      [candidate.displayName, candidate.normalizedName],
      candidate.searchIndex.keywords,
    );
    if (!bestMatch) {
      return false;
    }

    const signature = this.parseRegularNameSignature(candidate.normalizedName);
    if (!signature || signature.givenTokens.every((token) => token.length <= 1)) {
      return false;
    }

    return (
      bestMatch.exact ||
      bestMatch.subset ||
      bestMatch.score >= 0.78
    );
  }

  private isSparseQueryVariantCandidate(item: UnifiedAuthorCandidate) {
    const tokens = this.nameTokensForSignature(item.normalizedName);
    if (tokens.length < 2 || tokens.length > 3) {
      return false;
    }

    const hasClarivate = this.hasPlatform(item, 'clarivate_wos');
    const hasNoContext = !this.hasMeaningfulSearchContext(item);

    return hasClarivate && hasNoContext;
  }

  private isRicherQueryVariantCandidate(item: UnifiedAuthorCandidate) {
    return Boolean(
      this.hasMeaningfulSearchContext(item) ||
        item.searchIndex.emailDomain ||
        item.sourceProfiles.length > 1,
    );
  }

  private hasQuerySurnameVariantMatch(
    shorterCandidate: UnifiedAuthorCandidate,
    longerCandidate: UnifiedAuthorCandidate,
  ) {
    const shorter = this.nameTokensForSignature(shorterCandidate.normalizedName);
    const longer = this.nameTokensForSignature(longerCandidate.normalizedName);

    if (
      shorter.length < 2 ||
      longer.length <= shorter.length ||
      longer.length - shorter.length > 2
    ) {
      return false;
    }

    return shorter.every((token, index) => token === longer[index]);
  }

  private hasExactLongNameSparseDuplicate(
    sparseCandidate: UnifiedAuthorCandidate,
    richerCandidate: UnifiedAuthorCandidate,
  ) {
    const sparseTokens = this.nameTokensForSignature(sparseCandidate.normalizedName);
    if (
      sparseCandidate.normalizedName !== richerCandidate.normalizedName ||
      sparseTokens.length < 3
    ) {
      return false;
    }

    if (
      this.hasDifferentKnownInstitution(sparseCandidate, richerCandidate) ||
      this.hasDifferentKnownEmailDomain(sparseCandidate, richerCandidate)
    ) {
      return false;
    }

    return this.isSparseQueryVariantCandidate(sparseCandidate);
  }

  private hasExactLongNameComplementaryDuplicate(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const tokens = this.nameTokensForSignature(left.normalizedName);
    if (
      left.normalizedName !== right.normalizedName ||
      tokens.length < 3 ||
      this.hasDifferentKnownEmailDomain(left, right)
    ) {
      return false;
    }

    const leftHasContext = this.hasMeaningfulSearchContext(left);
    const rightHasContext = this.hasMeaningfulSearchContext(right);
    const leftHasEmail = Boolean(left.searchIndex.emailDomain?.trim());
    const rightHasEmail = Boolean(right.searchIndex.emailDomain?.trim());
    const leftHasMultipleSources = left.sourceProfiles.length > 1;
    const rightHasMultipleSources = right.sourceProfiles.length > 1;

    return Boolean(
      (leftHasEmail && rightHasContext) ||
        (rightHasEmail && leftHasContext) ||
        (leftHasMultipleSources && (rightHasContext || rightHasEmail)) ||
        (rightHasMultipleSources && (leftHasContext || leftHasEmail)),
    );
  }

  private hasMeaningfulSearchContext(item: UnifiedAuthorCandidate) {
    if (
      item.searchIndex.university ||
      item.searchIndex.institutionKey ||
      item.searchIndex.city ||
      item.searchIndex.country
    ) {
      return true;
    }

    return item.affiliations.some(
      (affiliation) =>
        Boolean(
          affiliation.university ||
            affiliation.institutionCanonicalKey ||
            affiliation.institutionCanonicalName ||
            affiliation.city ||
            affiliation.country,
        ),
    );
  }

  private parsePubmedNameSignature(normalizedName: string) {
    const tokens = this.nameTokensForSignature(normalizedName);
    if (tokens.length < 2) {
      return null;
    }

    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const isShort = (value: string) => /^[a-z]{1,3}$/i.test(value);

    // Most common PubMed style after normalization: "yuce yk"
    if (isShort(last)) {
      return { lastName: first, initials: last, givenTokens: [last] };
    }
    if (isShort(first)) {
      return { lastName: last, initials: first, givenTokens: [first] };
    }

    return null;
  }

  private parseRegularNameSignature(normalizedName: string) {
    const tokens = this.nameTokensForSignature(normalizedName);
    if (tokens.length < 2) {
      return null;
    }

    const lastName = tokens[tokens.length - 1];
    const givenTokens = tokens.slice(0, -1);
    const initials = givenTokens.map((token) => token[0]).join('');
    return { lastName, initials, givenTokens };
  }

  private extractClarivateComparableNameSignature(item: UnifiedAuthorCandidate) {
    if (this.hasPlatform(item, 'clarivate_wos')) {
      const clarivateNormalized = this.normalizeClarivatePersonName(
        item.displayName || item.normalizedName,
      );
      return this.parseRegularNameSignature(clarivateNormalized);
    }

    return this.parseRegularNameSignature(item.normalizedName);
  }

  private areInitialsCompatible(
    leftInitials: string,
    rightInitials: string,
    rightGivenTokens: string[],
    options?: {
      allowSingleInitialTokenMatch?: boolean;
    },
  ) {
    if (!leftInitials || !rightInitials) {
      return false;
    }

    if (
      rightInitials.startsWith(leftInitials) ||
      leftInitials.startsWith(rightInitials)
    ) {
      return true;
    }

    if (leftInitials.length === 1) {
      return (
        (rightGivenTokens.length === 1 ||
          options?.allowSingleInitialTokenMatch === true) &&
        rightGivenTokens.some((token) => token.startsWith(leftInitials))
      );
    }

    return false;
  }

  private hasPlatform(item: UnifiedAuthorCandidate, platform: string) {
    return item.sourceProfiles.some((profile) => profile.platform === platform);
  }

  private hasDisplayNameSourceNoise(value: string) {
    return /\b(google scholar|google akademik|scholar|akademik|citations?)\b/i.test(
      value,
    );
  }

  private hasInstitutionMatch(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    const leftInstitutionKey = left.searchIndex.institutionKey?.trim();
    const rightInstitutionKey = right.searchIndex.institutionKey?.trim();
    if (leftInstitutionKey && rightInstitutionKey) {
      return leftInstitutionKey === rightInstitutionKey;
    }

    const leftUni = left.searchIndex.university?.trim();
    const rightUni = right.searchIndex.university?.trim();
    if (!leftUni || !rightUni) {
      return false;
    }

    return (
      this.normalizeForSearch(leftUni) === this.normalizeForSearch(rightUni) ||
      areInstitutionNamesEquivalent(leftUni, rightUni)
    );
  }

  private hasDifferentKnownInstitution(
    left: UnifiedAuthorCandidate,
    right: UnifiedAuthorCandidate,
  ) {
    if (this.hasInstitutionMatch(left, right)) {
      return false;
    }

    const leftUni = left.searchIndex.university?.trim();
    const rightUni = right.searchIndex.university?.trim();
    if (!leftUni || !rightUni) {
      return false;
    }

    return true;
  }

  private firstMatch(value: string, patterns: RegExp[]) {
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match) {
        continue;
      }

      const picked = (match[1] ?? match[0])?.trim();
      if (picked) {
        return picked;
      }
    }
    return null;
  }

  private extractQueryParam(url: string | undefined, param: string) {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      return parsed.searchParams.get(param);
    } catch {
      return null;
    }
  }

  private mapDbAffiliations(item: Record<string, unknown>): ParsedAffiliation[] {
    const parsed = item.parsedAffiliations;
    if (Array.isArray(parsed)) {
      const normalized = parsed.filter(
        (x): x is ParsedAffiliation =>
          typeof x === 'object' && x !== null && typeof (x as ParsedAffiliation).raw === 'string',
      );
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return this.readStringArray(item, 'affiliations').map((raw) =>
      this.parseAffiliation(raw),
    );
  }

  private toPlainRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const maybeDoc = value as { toObject?: () => Record<string, unknown> };
    if (typeof maybeDoc.toObject === 'function') {
      return maybeDoc.toObject();
    }

    return value as Record<string, unknown>;
  }

  private readSourceProfiles(item: Record<string, unknown>) {
    const value = item.sourceProfiles;
    if (!Array.isArray(value)) {
      return [] as UnifiedAuthorCandidate['sourceProfiles'];
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const raw = entry as Record<string, unknown>;
        const platform =
          typeof raw.platformKey === 'string'
            ? raw.platformKey
            : typeof raw.platform === 'string'
              ? raw.platform
              : undefined;
        const externalAuthorId =
          typeof raw.externalAuthorId === 'string'
            ? raw.externalAuthorId
            : undefined;
        if (!platform || !externalAuthorId) {
          return null;
        }
        return {
          platform,
          externalAuthorId,
          profileUrl:
            typeof raw.profileUrl === 'string' ? raw.profileUrl : undefined,
          score: typeof raw.score === 'number' ? raw.score : undefined,
        };
      })
      .filter((entry) => !!entry) as UnifiedAuthorCandidate['sourceProfiles'];
  }

  private formatDiscoveryResponseCandidateOutput(
    item: DiscoveryResponseCandidate,
  ) {
    const sourceProfilesRaw = item.sourceProfiles.map((profile) => ({
      ...profile,
    }));
    const sourceProfiles = this.formatDiscoverySourceProfiles(sourceProfilesRaw);

    return {
      ...item,
      sourceProfiles,
      sourceProfilesRaw,
      sourcePlatforms: sourceProfiles.map((profile) => profile.platformLabel),
    };
  }

  private formatDiscoverySourceProfiles(
    profiles: UnifiedAuthorCandidate['sourceProfiles'],
  ) {
    const byPlatform = new Map<
      string,
      UnifiedAuthorCandidate['sourceProfiles'][number]
    >();

    for (const profile of profiles) {
      const platformKey = this.getCanonicalPlatformKey(profile.platform);
      const existing = byPlatform.get(platformKey);
      if (!existing) {
        byPlatform.set(platformKey, profile);
        continue;
      }

      if (
        this.discoverySourceProfileScore(profile) >
        this.discoverySourceProfileScore(existing)
      ) {
        byPlatform.set(platformKey, profile);
      }
    }

    return Array.from(byPlatform.entries()).map(([platformKey, profile]) => ({
      ...profile,
      platform: this.getPlatformDisplayName(platformKey),
      platformKey,
      platformLabel: this.getPlatformDisplayName(platformKey),
    }));
  }

  private discoverySourceProfileScore(
    profile: UnifiedAuthorCandidate['sourceProfiles'][number],
  ) {
    let score = 0;

    if (typeof profile.score === 'number' && Number.isFinite(profile.score)) {
      score += profile.score;
    }
    if (profile.profileUrl?.trim()) {
      score += 25;
    }
    if (profile.externalAuthorId?.trim()) {
      score += Math.min(profile.externalAuthorId.trim().length, 20);
    }

    return score;
  }

  private getCanonicalPlatformKey(platform: string) {
    const normalized = platform.trim().toLowerCase();

    if (['serpapi_scholar', 'google_scholar'].includes(normalized)) {
      return 'google_scholar';
    }
    if (normalized === 'trdizin') {
      return 'trdizin';
    }
    if (['scraper_scopus', 'scopus_scraper', 'scopus'].includes(normalized)) {
      return 'scopus';
    }
    if (['scraper_pubmed', 'pubmed'].includes(normalized)) {
      return 'pubmed';
    }
    if (
      ['clarivate_wos', 'clarivate_wos_starter', 'clarivate', 'wos'].includes(
        normalized,
      )
    ) {
      return 'clarivate_wos';
    }

    return normalized;
  }

  private getPlatformDisplayName(platform: string) {
    switch (this.getCanonicalPlatformKey(platform)) {
      case 'google_scholar':
        return 'Google Scholar';
      case 'trdizin':
        return 'TR Dizin';
      case 'scopus':
        return 'Scopus';
      case 'pubmed':
        return 'PubMed';
      case 'clarivate_wos':
        return 'Web Of Science';
      default:
        return platform;
    }
  }

  private readString(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && '_id' in (value as Record<string, unknown>)) {
      const nested = (value as Record<string, unknown>)._id;
      if (typeof nested === 'string') {
        return nested;
      }
      return nested != null ? String(nested) : null;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toString?: () => string }).toString === 'function'
    ) {
      const rendered = (value as { toString: () => string }).toString();
      if (rendered && rendered !== '[object Object]') {
        return rendered;
      }
      return null;
    }
    return value != null ? String(value) : null;
  }

  private readStringArray(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (!Array.isArray(value)) {
      return [] as string[];
    }
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => !!entry);
  }

  private extractPubmedAuthorCandidates(
    query: string,
    nameParts: { firstName?: string; lastName?: string } | undefined,
    articles: Array<{
      authors: string | null;
      score?: number;
      detail?: {
        authorDetails?: Array<{
          fullName?: string;
          affiliations?: string[];
        }>;
      } | null;
    }>,
  ) {
    const queryNormalized = this.normalizePersonName(query);
    const queryTokens = queryNormalized.split(' ').filter(Boolean);
    const queryLastName =
      this.normalizeForSearch(nameParts?.lastName ?? '').split(' ')[0] ||
      queryTokens[queryTokens.length - 1] ||
      '';
    const queryFirstTokens = this.normalizeForSearch(nameParts?.firstName ?? '')
      .split(' ')
      .filter(Boolean);
    const queryInitials = queryFirstTokens.map((t) => t[0]).join('');
    const queryFirstInitial = queryFirstTokens[0]?.[0] ?? '';

    if (!queryLastName) {
      return [];
    }

    const byName = new Map<
      string,
      {
        displayName: string;
        normalizedName: string;
        count: number;
        bestScore: number;
        affiliationRaw: string[];
      }
    >();

    for (const article of articles) {
      const detailAuthors = article.detail?.authorDetails ?? [];
      let matchedDetailAuthor = false;

      for (const detailAuthor of detailAuthors) {
        const displayName = detailAuthor.fullName?.trim() ?? '';
        if (
          !displayName ||
          !this.pubmedAuthorNameMatchesQuery(
            displayName,
            queryLastName,
            queryInitials,
            queryFirstInitial,
          )
        ) {
          continue;
        }

        matchedDetailAuthor = true;
        const normalizedName = this.normalizePersonName(displayName);
        if (!normalizedName) {
          continue;
        }

        const key = normalizedName;
        const affiliationRaw = [
          ...new Set(
            (detailAuthor.affiliations ?? [])
              .map((item) => item?.trim())
              .filter((item): item is string => !!item),
          ),
        ];
        const existing = byName.get(key);
        if (!existing) {
          byName.set(key, {
            displayName,
            normalizedName,
            count: 1,
            bestScore: article.score ?? 0,
            affiliationRaw,
          });
          continue;
        }

        existing.count += 1;
        existing.bestScore = Math.max(existing.bestScore, article.score ?? 0);
        existing.affiliationRaw = [
          ...new Set([...existing.affiliationRaw, ...affiliationRaw]),
        ];
      }

      if (matchedDetailAuthor) {
        continue;
      }

      const rawAuthors = article.authors ?? '';
      if (!rawAuthors.trim()) {
        continue;
      }

      const parts = rawAuthors
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      for (const authorText of parts) {
        const normalizedAuthor = this.normalizeForSearch(authorText);
        if (!normalizedAuthor.includes(queryLastName)) {
          continue;
        }

        const hasFullInitial =
          !!queryInitials &&
          normalizedAuthor.includes(`${queryLastName} ${queryInitials}`);
        const hasFirstInitial =
          !!queryFirstInitial &&
          normalizedAuthor.includes(`${queryLastName} ${queryFirstInitial}`);

        if (queryInitials && !hasFullInitial && !hasFirstInitial) {
          continue;
        }

        const normalizedName = this.normalizePersonName(authorText);
        if (!normalizedName) {
          continue;
        }

        const key = normalizedName;
        const existing = byName.get(key);
        if (!existing) {
          byName.set(key, {
            displayName: authorText,
            normalizedName,
            count: 1,
            bestScore: article.score ?? 0,
            affiliationRaw: [],
          });
          continue;
        }

        existing.count += 1;
        existing.bestScore = Math.max(existing.bestScore, article.score ?? 0);
      }
    }

    return Array.from(byName.values())
      .sort((a, b) => b.count - a.count || b.bestScore - a.bestScore)
      .map((item) => {
        const score = Math.min(item.count * 3 + item.bestScore, 30);
        const parsedAffiliations = item.affiliationRaw.map((raw) =>
          this.parseAffiliation(raw, 'scraper_pubmed'),
        );
        return this.applyInstitutionIdentity({
          displayName: item.displayName,
          normalizedName: item.normalizedName,
          affiliations: parsedAffiliations,
          affiliationRaw: item.affiliationRaw,
          searchIndex: this.buildSearchIndex(
            item.displayName,
            item.normalizedName,
            parsedAffiliations,
          ),
          sourceProfiles: [
            {
              platform: 'scraper_pubmed',
              externalAuthorId: item.normalizedName,
              profileUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(
                `${queryLastName} ${queryInitials || queryFirstInitial}[Author]`,
              )}`,
              score,
            },
          ],
          score,
        });
      });
  }

  private pubmedAuthorNameMatchesQuery(
    candidateName: string,
    queryLastName: string,
    queryInitials: string,
    queryFirstInitial: string,
  ) {
    const normalizedCandidate = this.normalizePersonName(candidateName);
    if (!normalizedCandidate) {
      return false;
    }

    const pubmedSig = this.parsePubmedNameSignature(normalizedCandidate);
    if (pubmedSig) {
      if (pubmedSig.lastName !== queryLastName) {
        return false;
      }
      if (!queryInitials) {
        return true;
      }
      return (
        pubmedSig.initials.startsWith(queryInitials) ||
        queryInitials.startsWith(pubmedSig.initials) ||
        (!!queryFirstInitial && pubmedSig.initials.startsWith(queryFirstInitial))
      );
    }

    const regularSig = this.parseRegularNameSignature(normalizedCandidate);
    if (!regularSig) {
      return false;
    }

    if (regularSig.lastName !== queryLastName) {
      return false;
    }

    if (!queryInitials) {
      return true;
    }

    return (
      regularSig.initials.startsWith(queryInitials) ||
      queryInitials.startsWith(regularSig.initials) ||
      (!!queryFirstInitial && regularSig.initials.startsWith(queryFirstInitial))
    );
  }
}
