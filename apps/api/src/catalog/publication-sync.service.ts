import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ClarivateService } from '../clarivate/clarivate.service';
import { normalizePersonName } from '../common/normalize-person-name';
import { arePersonNamesCompatible } from '../common/person-name-match';
import { ScraperService } from '../scraper/scraper.service';
import { SerpapiService } from '../serpapi/serpapi.service';
import { TrdizinService } from '../trdizin/trdizin.service';
import { Author, AuthorDocument } from './schemas/author.schema';
import { Publication, PublicationDocument } from './schemas/publication.schema';

type PlainObject = Record<string, unknown>;

type AuthorSourceProfile = {
  platform: string;
  externalAuthorId: string;
  profileUrl?: string;
};

type AuthorRecord = {
  _id: Types.ObjectId;
  fullName: string;
  aliases?: string[];
  normalizedName?: string;
  sourceProfiles?: AuthorSourceProfile[];
  affiliations?: string[];
  parsedAffiliations?: PlainObject[];
  institutionAliases?: string[];
  institutionCanonicalKey?: string;
  university?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
};

type SourceRecordInput = {
  platform: string;
  sourceId?: string;
  sourceUrl?: string;
  metadata?: PlainObject;
};

type HarvestedPublication = {
  title: string;
  normalizedTitle: string;
  doi?: string;
  fingerprint: string;
  titleYearKey?: string;
  journal?: string;
  publishedAt?: string;
  publishedYear?: number;
  authors: string[];
  authorsText?: string;
  abstract?: string;
  snippet?: string;
  keywords: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  pmid?: string;
  citationCount?: number;
  sourceRecords: SourceRecordInput[];
};

type ProviderSyncStatus = 'ok' | 'error' | 'unsupported' | 'skipped';

type ProviderSyncResult = {
  platform: string;
  status: ProviderSyncStatus;
  totalRaw: number;
  totalNormalized: number;
  reason?: string;
  publications: HarvestedPublication[];
};

type CrossrefWorkMatch = {
  doi: string;
  score: number;
  title?: string;
  sourceUrl?: string;
  journal?: string;
  publishedYear?: number;
};

const PUBMED_MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

@Injectable()
export class PublicationSyncService {
  private readonly logger = new Logger(PublicationSyncService.name);
  private readonly crossrefBaseUrl = 'https://api.crossref.org/works';
  private readonly crossrefMailto = process.env.CROSSREF_MAILTO?.trim() ?? '';
  private readonly crossrefTimeoutMs = this.parsePositiveInt(
    process.env.CROSSREF_TIMEOUT_MS,
    8000,
  );
  private readonly crossrefCacheTtlMs = this.parsePositiveInt(
    process.env.CROSSREF_CACHE_TTL_MS,
    24 * 60 * 60 * 1000,
  );
  private readonly scholarDoiEnrichmentConcurrency = this.parsePositiveInt(
    process.env.SCHOLAR_DOI_ENRICH_CONCURRENCY,
    3,
  );
  private readonly crossrefCache = new Map<
    string,
    {
      expiresAt: number;
      value: CrossrefWorkMatch | null;
    }
  >();

  constructor(
    @InjectModel(Author.name) private readonly authorModel: Model<AuthorDocument>,
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<PublicationDocument>,
    private readonly serpapiService: SerpapiService,
    private readonly trdizinService: TrdizinService,
    private readonly clarivateService: ClarivateService,
    private readonly scraperService: ScraperService,
  ) {}

  async syncAuthorPublications(
    authorId: string,
    limitPerSource = 25,
    options?: { force?: boolean; publishedFrom?: Date; publishedTo?: Date },
  ) {
    if (!Types.ObjectId.isValid(authorId)) {
      throw new BadRequestException('Gecersiz authorId.');
    }

    const safeLimit = Math.min(Math.max(limitPerSource, 1), 100);
    const force = Boolean(options?.force);
    const hasPublicationDateFilter = Boolean(
      options?.publishedFrom || options?.publishedTo,
    );
    const author = (await this.authorModel
      .findById(authorId)
      .lean()
      .exec()) as AuthorRecord | null;

    if (!author) {
      throw new NotFoundException('Yazar bulunamadi.');
    }

    const identityCluster = await this.loadAuthorIdentityCluster(author);
    const authorForSync = this.buildClusteredAuthorRecord(author, identityCluster);

    this.logger.log(
      `[Publication Sync] Basladi | yazar="${author.fullName}" | authorId="${authorId}" | limit=${safeLimit} | force=${force} | identityCluster=${identityCluster.authorIds.length} | kaynakProfilleri=${this.formatSourceProfiles(authorForSync.sourceProfiles)}`,
    );

    const existingPublications = hasPublicationDateFilter
      ? await this.loadCatalogPublications(
          authorForSync,
          undefined,
          identityCluster.authorIds,
        )
      : await this.loadCatalogPublications(
          authorForSync,
          options,
          identityCluster.authorIds,
        );
    const responsePublications = hasPublicationDateFilter
      ? await this.loadCatalogPublications(
          authorForSync,
          options,
          identityCluster.authorIds,
        )
      : existingPublications;
    this.logger.log(
      `[Publication Sync] Veritabani kontrolu tamamlandi | yazar="${author.fullName}" | mevcutMakaleSayisi=${existingPublications.length} | filtrelenmisMakaleSayisi=${responsePublications.length}`,
    );

    if (existingPublications.length > 0 && !force) {
      this.logger.log(
        `[Publication Sync] DB-FIRST isabeti | yazar="${author.fullName}" | tarama yapilmadan veritabanindaki makaleler donduruluyor.`,
      );

      return {
        mode: 'database',
        dbHit: true,
        force,
        authorId: author._id.toString(),
        authorName: author.fullName,
        totalHarvested: 0,
        totalMerged: responsePublications.length,
        totalUpserted: 0,
        catalogCount: responsePublications.length,
        providers: this.buildDbHitProviderResults(authorForSync).map((result) =>
          this.formatProviderResultOutput(result),
        ),
        publications: responsePublications,
        syncedAt: new Date().toISOString(),
      };
    }

    if (force && existingPublications.length > 0) {
      this.logger.log(
        `[Publication Sync] Zorla yenileme aktif | yazar="${author.fullName}" | mevcutKayitlarTekrarTaranacak=${existingPublications.length}`,
      );
    } else {
      this.logger.log(
        `[Publication Sync] Veritabaninda makale bulunamadi | yazar="${author.fullName}" | tum kaynaklar taranacak.`,
      );
    }

    const providerResults: ProviderSyncResult[] = [];
    providerResults.push(
      await this.harvestSerpapiPublications(authorForSync, safeLimit),
    );
    providerResults.push(
      await this.harvestTrdizinPublications(authorForSync, safeLimit),
    );
    providerResults.push(
      await this.harvestPubmedPublications(authorForSync, safeLimit),
    );
    providerResults.push(
      await this.harvestClarivatePublications(authorForSync, safeLimit),
    );
    providerResults.push(await this.harvestScopusPublications(authorForSync));

    const harvested = providerResults.flatMap((result) => result.publications);
    this.logger.log(
      `[Publication Sync] Provider taramasi tamamlandi | yazar="${author.fullName}" | hamMakaleSayisi=${harvested.length}`,
    );

    const merged = this.mergeHarvestedPublications(
      harvested,
      authorForSync.sourceProfiles,
    );
    this.logger.log(
      `[Publication Sync] Gecici birlestirme tamamlandi | yazar="${author.fullName}" | birlesikMakaleSayisi=${merged.length}`,
    );

    let totalUpserted = 0;
    for (const publication of merged) {
      await this.upsertPublication(authorForSync, publication);
      totalUpserted += 1;
    }

    const catalogPublications = await this.loadCatalogPublications(
      authorForSync,
      options,
      identityCluster.authorIds,
    );
    const filteredCatalogPublications = catalogPublications;
    const publishedWithinYears = hasPublicationDateFilter
      ? 'custom_range'
      : 'all';
    this.logger.log(
      `[Publication Sync] Tamamlandi | yazar="${author.fullName}" | ham=${harvested.length} | birlesik=${merged.length} | upsert=${totalUpserted} | katalogToplam=${catalogPublications.length} | filtrelenmisToplam=${filteredCatalogPublications.length} | publishedWithinYears=${publishedWithinYears}`,
    );

    return {
      mode: 'provider_sync',
      dbHit: false,
      force,
      authorId: author._id.toString(),
      authorName: author.fullName,
      totalHarvested: harvested.length,
      totalMerged: merged.length,
      totalUpserted,
      catalogCount: catalogPublications.length,
      filteredCount: filteredCatalogPublications.length,
      publishedWithinYears,
      providers: providerResults.map((result) =>
        this.formatProviderResultOutput(result),
      ),
      publications: filteredCatalogPublications,
      syncedAt: new Date().toISOString(),
    };
  }

  private async harvestSerpapiPublications(
    author: AuthorRecord,
    limit: number,
  ): Promise<ProviderSyncResult> {
    const platform = 'serpapi_scholar';
    const profile = this.findSourceProfile(author, [platform]);
    if (!profile) {
      this.logger.log(
        `[Publication Sync][${platform}] Kaynak profili bulunamadi, atlandi.`,
      );
      return this.buildSkippedProviderResult(
        platform,
        'Yazarda SerpAPI Scholar profili bulunamadi.',
      );
    }

    this.logger.log(
      `[Publication Sync][${platform}] Tarama basladi | externalAuthorId="${profile.externalAuthorId}" | limit=${limit}`,
    );

    try {
      const searchName = this.getProviderSearchName(author.fullName);
      let result = await this.serpapiService.getAuthorPublications({
        authorId: profile.externalAuthorId,
        hl: 'tr',
        sort: 'pubdate',
        limit,
      });

      if ((result.publications ?? []).length === 0 && searchName !== author.fullName) {
        this.debugConsole(platform, 'Kayitli Scholar authorId bos dondu, isim bazli fallback deneniyor.', {
          authorId: profile.externalAuthorId,
          searchName,
        });

        const fallbackSearch = await this.serpapiService.searchAuthorsNormalized({
          q: searchName,
          hl: 'tr',
          limit: 5,
        });
        this.debugConsole(platform, 'Scholar author fallback sonucu', fallbackSearch);

        const fallbackAuthors = Array.isArray(fallbackSearch.authors)
          ? (fallbackSearch.authors as Array<Record<string, unknown>>)
          : [];
        const fallbackAuthorId = fallbackAuthors
          .map((item) =>
            typeof item.author_id === 'string'
              ? item.author_id
              : typeof item.authorId === 'string'
                ? item.authorId
                : null,
          )
          .find((item): item is string => Boolean(item?.trim()));

        if (fallbackAuthorId && fallbackAuthorId !== profile.externalAuthorId) {
          this.debugConsole(platform, 'Scholar fallback authorId secildi, publication tekrar deneniyor.', {
            previousAuthorId: profile.externalAuthorId,
            fallbackAuthorId,
          });
          result = await this.serpapiService.getAuthorPublications({
            authorId: fallbackAuthorId,
            hl: 'tr',
            sort: 'pubdate',
            limit,
          });
        }
      }

      const sourceItems = Array.isArray(result.publications)
        ? (result.publications as PlainObject[])
        : [];
      const enrichedSourceItems =
        await this.enrichSerpapiScholarPublications(
          profile.externalAuthorId,
          sourceItems,
        );

      const publications = enrichedSourceItems
        .map((item) => {
          const title = this.readString(item, ['title']) ?? '';
          if (!title) {
            return null;
          }

          const citationId = this.readString(item, ['citationId']) ?? undefined;
          const sourceUrl =
            this.readString(item, ['serpapiLink']) ??
            (citationId
              ? this.buildScholarCitationUrl(
                  profile.externalAuthorId,
                  citationId,
                )
              : profile.profileUrl);

          return this.createHarvestedPublication({
            title,
            doi: this.readString(item, ['doi']) ?? undefined,
            journal:
              this.readString(item, ['journal']) ??
              this.readString(item, ['publication']) ??
              undefined,
            publishedAt:
              this.readString(item, ['publishedAt']) ?? undefined,
            publishedYear: this.readNumber(item, ['publishedYear', 'year']) ?? undefined,
            authors: this.splitAuthorText(
              this.readString(item, ['authors']) ?? undefined,
            ),
            authorsText: this.readString(item, ['authors']) ?? undefined,
            abstract:
              this.readString(item, ['abstract', 'description']) ?? undefined,
            snippet: this.readString(item, ['snippet']) ?? undefined,
            publisher: this.readString(item, ['publisher']) ?? undefined,
            volume: this.readString(item, ['volume']) ?? undefined,
            issue: this.readString(item, ['issue']) ?? undefined,
            pages: this.readString(item, ['pages']) ?? undefined,
            citationCount: this.readNumber(item, ['citedBy']) ?? undefined,
            sourceRecord: {
              platform,
              sourceId: citationId,
              sourceUrl,
              metadata: {
                rawPublication: item as unknown as PlainObject,
              },
            },
          });
        })
        .filter((item): item is HarvestedPublication => item !== null);

      for (const publication of publications) {
        this.logNormalizedPublication(platform, publication);
      }

      this.logger.log(
        `[Publication Sync][${platform}] Tarama tamamlandi | ham=${sourceItems.length} | normalize=${publications.length}`,
      );

      return {
        platform,
        status: 'ok',
        totalRaw: sourceItems.length,
        totalNormalized: publications.length,
        publications,
      };
    } catch (error) {
      return this.buildErrorProviderResult(platform, error);
    }
  }

  private async harvestTrdizinPublications(
    author: AuthorRecord,
    limit: number,
  ): Promise<ProviderSyncResult> {
    const platform = 'trdizin';
    let profile = this.findSourceProfile(author, [platform]);
    if (!profile) {
      this.debugConsole(platform, 'Kaynak profili bulunamadi, isimden author adayi aranacak.', {
        authorId: author._id.toString(),
        fullName: author.fullName,
      });

      try {
        const authorSearch = await this.trdizinService.searchAuthorsNormalized({
          q: author.fullName,
          limit: 5,
        });

        this.debugConsole(platform, 'TR Dizin author fallback sonucu', authorSearch);
        const bestCandidate = Array.isArray(authorSearch.authors)
          ? authorSearch.authors.find(
              (candidate) =>
                typeof candidate?.authorId === 'string' &&
                Number.isInteger(Number(candidate.authorId)) &&
                Number(candidate.authorId) > 0,
            ) ?? null
          : null;

        if (bestCandidate) {
          profile = {
            platform,
            externalAuthorId: bestCandidate.authorId,
            profileUrl:
              typeof bestCandidate.profileUrl === 'string'
                ? bestCandidate.profileUrl
                : undefined,
          };
          this.debugConsole(platform, 'TR Dizin fallback author secildi.', bestCandidate);
        } else {
          this.debugConsole(platform, 'TR Dizin fallback author bulunamadi, provider atlandi.');
          this.logger.log(
            `[Publication Sync][${platform}] Kaynak profili yok ve isimden author bulunamadi, atlandi.`,
          );
          return this.buildSkippedProviderResult(
            platform,
            'Yazarda TR Dizin profili yok, isimden de uygun author bulunamadi.',
          );
        }
      } catch (error) {
        return this.buildErrorProviderResult(platform, error);
      }
    }

    const authorId = Number(profile.externalAuthorId);
    if (!Number.isInteger(authorId) || authorId <= 0) {
      const reason = `Gecersiz TR Dizin authorId: ${profile.externalAuthorId}`;
      this.debugConsole(platform, 'Gecersiz authorId nedeniyle islem durduruldu.', {
        externalAuthorId: profile.externalAuthorId,
        numericAuthorId: authorId,
      });
      this.logger.warn(`[Publication Sync][${platform}] ${reason}`);
      return {
        platform,
        status: 'error',
        totalRaw: 0,
        totalNormalized: 0,
        reason,
        publications: [],
      };
    }

    this.logger.log(
      `[Publication Sync][${platform}] Tarama basladi | externalAuthorId="${profile.externalAuthorId}" | limit=${limit}`,
    );

    try {
      const searchName = this.getProviderSearchName(author.fullName);
      const result = await this.trdizinService.searchPublicationsByAuthorId(
        searchName,
        authorId,
      );

      this.debugConsole(platform, 'TR Dizin provider ozet yaniti', {
        authorQuery: result.authorQuery,
        authorId: result.authorId,
        totalFetched: result.totalFetched,
        matchedCount: result.matchedCount,
        rawKeys: result.rawKeys,
        fetchedAt: result.fetchedAt,
      });

      const matched = Array.isArray(result.matchedPublications)
        ? result.matchedPublications
        : [];

      if (matched.length > limit) {
        this.debugConsole(platform, 'Limit nedeniyle tum eslesmeler islenmeyecek.', {
          matchedCount: matched.length,
          limit,
        });
      }

      const publications: HarvestedPublication[] = [];
      for (const [index, item] of matched.slice(0, limit).entries()) {
        this.debugConsole(platform, `Ham eslesme #${index + 1}`, item);
        const publication = this.readObject(item, ['publication']);
        const matchedAuthor = this.readObject(item, ['matchedAuthor']);

        if (!publication) {
          this.debugConsole(platform, `Ham eslesme #${index + 1} publication nesnesi icermiyor, elendi.`, item);
          continue;
        }

        const normalized = this.normalizeTrdizinPublication(publication, matchedAuthor);
        if (!normalized) {
          this.debugConsole(platform, `Ham eslesme #${index + 1} normalize edilemedi, elendi.`, {
            publication,
            matchedAuthor,
          });
          continue;
        }

        const trdizinAuthorCandidates = [
          ...this.extractMatchedAuthorNames(matchedAuthor),
          ...normalized.authors,
        ];
        if (
          trdizinAuthorCandidates.length > 0 &&
          !this.matchesCatalogAuthor(author, trdizinAuthorCandidates)
        ) {
          this.debugConsole(
            platform,
            `Ham eslesme #${index + 1} yazar imzasi uyumsuz oldugu icin elendi.`,
            {
              publication,
              matchedAuthor,
              trdizinAuthorCandidates,
              authorName: author.fullName,
            },
          );
          continue;
        }

        this.debugConsole(platform, `Normalize sonuc #${index + 1}`, normalized);
        publications.push(normalized);
      }

      for (const publication of publications) {
        this.logNormalizedPublication(platform, publication);
      }

      this.logger.log(
        `[Publication Sync][${platform}] Tarama tamamlandi | ham=${matched.length} | normalize=${publications.length}`,
      );

      return {
        platform,
        status: 'ok',
        totalRaw: matched.length,
        totalNormalized: publications.length,
        publications,
      };
    } catch (error) {
      return this.buildErrorProviderResult(platform, error);
    }
  }

  private async harvestPubmedPublications(
    author: AuthorRecord,
    limit: number,
  ): Promise<ProviderSyncResult> {
    const platform = 'scraper_pubmed';
    const profile = this.findSourceProfile(author, [platform]);
    if (!profile) {
      this.debugConsole(platform, 'Kaynak profili bulunamadi ama PubMed isim bazli taranacak.', {
        authorId: author._id.toString(),
        fullName: author.fullName,
      });
    }

    this.logger.log(
      `[Publication Sync][${platform}] Tarama basladi | yazar="${author.fullName}" | limit=${limit}`,
    );

    try {
      const searchName = this.getProviderSearchName(author.fullName);
      const result = await this.scraperService.searchPubmedAuthor(
        searchName,
        limit,
      );

      this.debugConsole(platform, 'PubMed provider ozet yaniti', {
        query: result.query,
        normalizedQuery: result.normalizedQuery,
        queryCandidates: result.queryCandidates,
        runs: result.runs,
        totalMatched: result.totalMatched,
        fetchedAt: result.fetchedAt,
      });

      const matched = Array.isArray(result.matchedArticles)
        ? result.matchedArticles
        : [];

      const publications: HarvestedPublication[] = [];
      for (const [index, item] of matched.entries()) {
        this.debugConsole(platform, `Ham eslesme #${index + 1}`, item);
        const normalized = this.normalizePubmedPublication(item);
        if (!normalized) {
          this.debugConsole(platform, `Ham eslesme #${index + 1} normalize edilemedi, elendi.`, item);
          continue;
        }

        const pubmedAuthorCandidates = this.collectPubmedAuthorCandidates(
          item,
          normalized,
        );
        if (
          pubmedAuthorCandidates.length > 0 &&
          !this.matchesCatalogAuthor(author, pubmedAuthorCandidates)
        ) {
          this.debugConsole(
            platform,
            `Ham eslesme #${index + 1} yazar imzasi uyumsuz oldugu icin elendi.`,
            {
              item,
              pubmedAuthorCandidates,
              authorName: author.fullName,
            },
          );
          continue;
        }

        this.debugConsole(platform, `Normalize sonuc #${index + 1}`, normalized);
        publications.push(normalized);
      }

      for (const publication of publications) {
        this.logNormalizedPublication(platform, publication);
      }

      this.logger.log(
        `[Publication Sync][${platform}] Tarama tamamlandi | ham=${matched.length} | normalize=${publications.length}`,
      );

      return {
        platform,
        status: 'ok',
        totalRaw: matched.length,
        totalNormalized: publications.length,
        publications,
      };
    } catch (error) {
      return this.buildErrorProviderResult(platform, error);
    }
  }

  private async harvestClarivatePublications(
    author: AuthorRecord,
    limit: number,
  ): Promise<ProviderSyncResult> {
    const platform = 'clarivate_wos';
    const profile = this.findSourceProfile(author, [
      platform,
      'clarivate_wos_starter',
      'clarivate',
      'wos',
    ]);

    if (!profile) {
      this.debugConsole(
        platform,
        'Clarivate profili bulunamadi ama isim bazli WoS taramasi deneniyor.',
        {
          authorId: author._id.toString(),
          fullName: author.fullName,
        },
      );
    }

    this.logger.log(
      `[Publication Sync][${platform}] Tarama basladi | yazar="${author.fullName}" | externalAuthorId="${profile?.externalAuthorId ?? '-'}" | limit=${limit}`,
    );

    try {
      const searchName = this.getProviderSearchName(author.fullName);
      const pageSize = Math.min(Math.max(limit, 10), 50);
      const result = await this.clarivateService.searchAuthors({
        q: searchName,
        limit: pageSize,
        maxPages: Math.max(1, Math.ceil(limit / pageSize) + 1),
        preferredResearcherId: profile?.externalAuthorId,
        preferredWosStandard: profile?.externalAuthorId,
        preferredDisplayName: author.fullName,
        preferredAffiliations: this.getClarivateAffiliationPreferences(author),
        preferredUniversity: author.university,
        preferredCity: author.city,
        preferredCountry: author.country,
      });

      this.debugConsole(platform, 'Clarivate provider ozet yaniti', {
        authorQuery: result.authorQuery,
        wosQuery: result.wosQuery,
        author: result.author,
        affiliations: result.affiliations,
        totalPublications: Array.isArray(result.publications)
          ? result.publications.length
          : 0,
        pagination: result.pagination,
        fetchedAt: result.fetchedAt,
      });

      if (!result.author) {
        this.logger.log(
          `[Publication Sync][${platform}] Clarivate uygun author match bulamadi, atlandi.`,
        );
        return this.buildSkippedProviderResult(
          platform,
          'Clarivate WoS tarafinda uygun author eslesmesi bulunamadi.',
        );
      }

      const matched = Array.isArray(result.publications)
        ? (result.publications as PlainObject[])
        : [];
      const publications: HarvestedPublication[] = [];

      for (const [index, item] of matched.slice(0, limit).entries()) {
        this.debugConsole(platform, `Ham publication #${index + 1}`, item);
        const normalized = this.normalizeClarivatePublication(item);
        if (!normalized) {
          this.debugConsole(
            platform,
            `Ham publication #${index + 1} normalize edilemedi, elendi.`,
            item,
          );
          continue;
        }

        const clarivateAuthorCandidates = this.mergeStringArrays(
          normalized.authors,
          [
            this.readString(item, [
              'authorNameInRecord',
              'matchedDisplayName',
            ]) ?? '',
          ],
        );
        if (
          clarivateAuthorCandidates.length > 0 &&
          !this.matchesCatalogAuthor(author, clarivateAuthorCandidates)
        ) {
          this.debugConsole(
            platform,
            `Ham publication #${index + 1} yazar imzasi uyumsuz oldugu icin elendi.`,
            {
              item,
              clarivateAuthorCandidates,
              authorName: author.fullName,
            },
          );
          continue;
        }

        if (!this.matchesClarivatePublicationContext(author, item, profile)) {
          this.debugConsole(
            platform,
            `Ham publication #${index + 1} kurum/konum baglami uyusmadigi icin elendi.`,
            {
              item,
              matchedAffiliations: this.readFlexibleStringArray(item, [
                'matchedAffiliations',
              ]),
              authorContext: {
                university: author.university,
                city: author.city,
                country: author.country,
                institutionAliases: author.institutionAliases,
              },
            },
          );
          continue;
        }

        this.debugConsole(platform, `Normalize sonuc #${index + 1}`, normalized);
        publications.push(normalized);
      }

      for (const publication of publications) {
        this.logNormalizedPublication(platform, publication);
      }

      this.logger.log(
        `[Publication Sync][${platform}] Tarama tamamlandi | ham=${matched.length} | normalize=${publications.length}`,
      );

      return {
        platform,
        status: 'ok',
        totalRaw: matched.length,
        totalNormalized: publications.length,
        publications,
      };
    } catch (error) {
      return this.buildErrorProviderResult(platform, error);
    }
  }

  private async harvestScopusPublications(
    author: AuthorRecord,
  ): Promise<ProviderSyncResult> {
    const profile = this.findSourceProfile(author, [
      'scraper_scopus',
      'scopus_scraper',
    ]);

    if (!profile) {
      this.debugConsole('scraper_scopus', 'Scopus profili bulunamadigi icin publication taramasi atlandi.', {
        authorId: author._id.toString(),
        fullName: author.fullName,
      });
      this.logger.log(
        '[Publication Sync][scraper_scopus] Kaynak profili bulunamadi, atlandi.',
      );
      return this.buildSkippedProviderResult(
        'scraper_scopus',
        'Yazarda Scopus scraper profili bulunamadi.',
      );
    }

    this.logger.log(
      `[Publication Sync][${profile.platform}] Tarama basladi | externalAuthorId="${profile.externalAuthorId}"`,
    );

    try {
      const detail = await this.scraperService.scrapeScopusAuthorDetailById(
        profile.externalAuthorId,
      );
      const detailParsed =
        detail && typeof detail === 'object' && !Array.isArray(detail)
          ? this.readObject(detail as PlainObject, ['detailParsed'])
          : null;
      const publicationSummary = detailParsed
        ? this.readObject(detailParsed, ['publicationSummary'])
        : null;
      const detailMetrics = detailParsed
        ? this.readObject(detailParsed, ['metrics'])
        : null;
      const rawPublications =
        detailParsed && Array.isArray(detailParsed.publications)
          ? (detailParsed.publications as PlainObject[])
          : [];

      this.debugConsole(profile.platform, 'Scopus detail ozet yaniti', {
        externalAuthorId: profile.externalAuthorId,
        authorName: detailParsed?.authorName,
        previewMode: detailParsed?.previewMode,
        renderMode: detailParsed?.renderMode,
        metrics: detailMetrics,
        publicationSummary,
        rawPublicationCount: rawPublications.length,
      });

      const publications: HarvestedPublication[] = [];
      for (const [index, item] of rawPublications.entries()) {
        this.debugConsole(profile.platform, `Ham publication #${index + 1}`, item);
        const normalized = this.normalizeScopusPublication(item, detailParsed);
        if (!normalized) {
          this.debugConsole(
            profile.platform,
            `Ham publication #${index + 1} normalize edilemedi, elendi.`,
            item,
          );
          continue;
        }

        this.debugConsole(
          profile.platform,
          `Normalize sonuc #${index + 1}`,
          normalized,
        );
        publications.push(normalized);
      }

      for (const publication of publications) {
        this.logNormalizedPublication(profile.platform, publication);
      }

      if (publications.length > 0) {
        this.logger.log(
          `[Publication Sync][${profile.platform}] Tarama tamamlandi | ham=${rawPublications.length} | normalize=${publications.length}`,
        );

        return {
          platform: profile.platform,
          status: 'ok',
          totalRaw: rawPublications.length,
          totalNormalized: publications.length,
          publications,
        };
      }

      const totalDocumentsRaw =
        (detailMetrics
          ? this.readNumber(detailMetrics, ['documents'])
          : undefined) ??
        (publicationSummary
          ? this.readNumber(publicationSummary, ['totalDocuments'])
          : undefined);
      const totalDocuments =
        typeof totalDocumentsRaw === 'number' ? totalDocumentsRaw : undefined;
      const emptyStatus = this.resolveScopusPublicationEmptyStatus(
        detailParsed,
        totalDocuments,
      );
      const reason = this.buildScopusPublicationUnavailableReason(
        detailParsed,
        totalDocuments,
      );

      if (emptyStatus === 'ok') {
        this.logger.log(
          `[Publication Sync][${profile.platform}] Scopus dokuman sayisi sifir gorunuyor, publication kaydi yok.`,
        );
      } else {
        this.logger.warn(
          `[Publication Sync][${profile.platform}] ${reason} externalAuthorId="${profile.externalAuthorId}"`,
        );
      }

      return {
        platform: profile.platform,
        status: emptyStatus,
        totalRaw: rawPublications.length,
        totalNormalized: 0,
        reason,
        publications: [],
      };
    } catch (error) {
      return this.buildErrorProviderResult(profile.platform, error);
    }
  }

  private normalizeTrdizinPublication(
    publication: PlainObject,
    matchedAuthor?: PlainObject | null,
  ): HarvestedPublication | null {
    const title = this.normalizeTrdizinTitleSpacing(
      this.readString(publication, ['orderTitle', 'title']),
    );
    if (!title) {
      this.debugConsole('trdizin', 'Baslik alani bos oldugu icin kayit elendi.', {
        publication,
        matchedAuthor,
      });
      return null;
    }

    const journalObject = this.readObject(publication, ['journal']);
    const issueObject = this.readObject(publication, ['issue']);
    const journal =
      (journalObject && this.readString(journalObject, ['name'])) ||
      this.readString(publication, ['journalName']);
    const publishedAt =
      (issueObject && this.readString(issueObject, ['publishDate'])) ||
      this.readString(publication, ['publishDate']);
    const publishedYear =
      this.readNumber(publication, ['publicationYear']) ||
      (issueObject && this.readNumber(issueObject, ['year'])) ||
      undefined;
    const sourceId = this.readString(publication, ['id']);
    const doi = this.normalizeDoi(this.readString(publication, ['doi']));
    const authors = this.readAuthorNamesFromPublication(publication);
    const authorsText = authors.length > 0 ? authors.join(', ') : undefined;
    const abstract = this.readString(publication, [
      'abstract',
      'summary',
      'description',
      'ozet',
    ]);
    const keywords = this.readFlexibleStringArray(publication, [
      'keywords',
      'keyword',
      'keyWords',
      'subjects',
      'subject',
    ]);
    const publisher =
      (journalObject &&
        this.readString(journalObject, ['publisher', 'publisherName'])) ||
      this.readString(publication, ['publisher', 'publisherName']);
    const volume =
      (issueObject && this.readString(issueObject, ['volume'])) ||
      this.readString(publication, ['volume']);
    const issue =
      (issueObject &&
        this.readString(issueObject, ['number', 'issueNumber', 'issue'])) ||
      this.readString(publication, ['issue', 'issueNumber']);
    const pages =
      this.buildPages(publication) ||
      (issueObject ? this.buildPages(issueObject) : undefined);
    const language = this.readString(publication, ['language', 'lang']);
    const normalizedPublishedAt = this.sanitizePublishedAt(
      this.normalizeIsoDate(publishedAt ?? undefined),
      publishedYear ?? undefined,
    );

    return this.createHarvestedPublication({
      title,
      doi,
      journal: journal ?? undefined,
      publishedAt: normalizedPublishedAt,
      publishedYear: publishedYear ?? undefined,
      authors,
      authorsText,
      abstract: abstract ?? undefined,
      keywords,
      publisher: publisher ?? undefined,
      volume: volume ?? undefined,
      issue: issue ?? undefined,
      pages: pages ?? undefined,
      language: language ?? undefined,
      sourceRecord: {
        platform: 'trdizin',
        sourceId: sourceId ?? undefined,
        metadata: {
          matchedAuthor: matchedAuthor ?? undefined,
          rawPublication: publication,
        },
      },
    });
  }

  private normalizePubmedPublication(
    publication: PlainObject,
  ): HarvestedPublication | null {
    const title = this.readString(publication, ['title']);
    if (!title) {
      this.debugConsole('scraper_pubmed', 'Baslik alani bos oldugu icin kayit elendi.', publication);
      return null;
    }

    const pmid = this.readString(publication, ['pmid']);
    const articleUrl = this.readString(publication, ['articleUrl']);
    const journalCitation = this.readString(publication, ['journalCitation']);
    const authorsText = this.readString(publication, ['authors']);
    const snippet = this.readString(publication, ['snippet']);
    const detail = this.readObject(publication, ['detail']);
    const parsedCitation = this.parsePubmedJournalCitation(journalCitation);
    const detailCitationDate = detail
      ? this.readString(detail, ['citationDate'])
      : null;
    const detailPublishedAt = this.normalizePubmedCitationDate(detailCitationDate);
    const detailAuthors = detail
      ? this.readStringArray(detail, ['fullAuthors'])
      : [];
    const detailAbstract = detail ? this.readString(detail, ['abstract']) : null;
    const score = this.readNumber(publication, ['score']);

    this.debugConsole('scraper_pubmed', 'journalCitation parse sonucu', {
      journalCitation,
      parsedCitation,
      detailCitationDate,
      pmid,
      score,
    });

    const publishedAt = this.sanitizePublishedAt(
      parsedCitation.publishedAt ?? detailPublishedAt,
      parsedCitation.publishedYear ??
        this.extractYear(detailCitationDate) ??
        undefined,
    );
    const publishedYear =
      parsedCitation.publishedYear ??
      (publishedAt ? new Date(publishedAt).getUTCFullYear() : undefined) ??
      this.extractYear(detailCitationDate);
    const resolvedAuthors =
      detailAuthors.length > 0
        ? this.mergeStringArrays([], detailAuthors)
        : this.splitAuthorText(authorsText ?? undefined);

    return this.createHarvestedPublication({
      title,
      doi:
        parsedCitation.doi ??
        (detail ? this.readString(detail, ['doi']) ?? undefined : undefined),
      journal:
        parsedCitation.journal ??
        (detail ? this.readString(detail, ['journal']) ?? undefined : undefined),
      publishedAt,
      publishedYear: publishedYear ?? undefined,
      authors: resolvedAuthors,
      authorsText:
        detailAuthors.length > 0 ? resolvedAuthors.join(', ') : authorsText ?? undefined,
      abstract: detailAbstract ?? undefined,
      snippet: snippet ?? undefined,
      volume:
        parsedCitation.volume ??
        (detail ? this.readString(detail, ['volume']) ?? undefined : undefined),
      issue:
        parsedCitation.issue ??
        (detail ? this.readString(detail, ['issue']) ?? undefined : undefined),
      pages: parsedCitation.pages,
      pmid: pmid ?? undefined,
      sourceRecord: {
        platform: 'scraper_pubmed',
        sourceId: pmid ?? undefined,
        sourceUrl: articleUrl ?? undefined,
        metadata: {
          journalCitation: journalCitation ?? undefined,
          score: score ?? undefined,
          matchedBy: Array.isArray(publication.matchedBy)
            ? publication.matchedBy
            : undefined,
          rawPublication: publication,
        },
      },
    });
  }

  private normalizeScopusPublication(
    publication: PlainObject,
    detailParsed?: PlainObject | null,
  ): HarvestedPublication | null {
    const title = this.readString(publication, ['title']);
    if (!title) {
      this.debugConsole(
        'scraper_scopus',
        'Scopus publication basligi bos oldugu icin kayit elendi.',
        publication,
      );
      return null;
    }

    const sourceId = this.readString(publication, ['sourceId', 'eid', 'documentId']);
    const sourceUrl = this.readString(publication, [
      'articleUrl',
      'sourceUrl',
      'recordUrl',
      'detailUrl',
    ]);
    const journal = this.readString(publication, [
      'journal',
      'sourceTitle',
      'publicationTitle',
    ]);
    const authorsText = this.readString(publication, ['authorsText', 'authors']);
    const authors = this.readStringArray(publication, ['authors']);
    const doi = this.readString(publication, ['doi']);
    const publishedAt = this.readString(publication, [
      'publishedAt',
      'coverDate',
      'publicationDate',
    ]);
    const publishedYear = this.readNumber(publication, [
      'publishedYear',
      'year',
    ]);
    const citationCount = this.readNumber(publication, [
      'citationCount',
      'citedBy',
    ]);
    const volume = this.readString(publication, ['volume']);
    const issue = this.readString(publication, ['issue']);
    const pages = this.buildPages(publication);
    const documentType = this.readString(publication, [
      'documentType',
      'subtypeDescription',
      'type',
    ]);

    return this.createHarvestedPublication({
      title,
      doi: doi ?? undefined,
      journal: journal ?? undefined,
      publishedAt: publishedAt ?? undefined,
      publishedYear: publishedYear ?? undefined,
      authors:
        authors.length > 0
          ? authors
          : this.splitAuthorText(authorsText ?? undefined),
      authorsText: authorsText ?? undefined,
      volume: volume ?? undefined,
      issue: issue ?? undefined,
      pages: pages ?? undefined,
      citationCount: citationCount ?? undefined,
      sourceRecord: {
        platform: 'scraper_scopus',
        sourceId: sourceId ?? undefined,
        sourceUrl: sourceUrl ?? undefined,
        metadata: {
          documentType: documentType ?? undefined,
          authorDetailSummary: detailParsed
            ? {
                authorId: this.readString(detailParsed, ['authorId']) ?? undefined,
                authorName:
                  this.readString(detailParsed, ['authorName']) ?? undefined,
                previewMode:
                  (detailParsed.previewMode as boolean | undefined) ?? undefined,
                renderMode:
                  this.readString(detailParsed, ['renderMode']) ?? undefined,
              }
            : undefined,
          rawPublication: publication,
        },
      },
    });
  }

  private normalizeClarivatePublication(
    publication: PlainObject,
  ): HarvestedPublication | null {
    const title = this.readString(publication, ['title']);
    if (!title) {
      this.debugConsole(
        'clarivate_wos',
        'Baslik alani bos oldugu icin kayit elendi.',
        publication,
      );
      return null;
    }

    const publishedYear = this.readNumber(publication, ['publishYear']) ?? undefined;
    const publishedAt = this.buildClarivatePublishedAt(
      publishedYear,
      this.readString(publication, ['publishMonth']),
    );
    const authors = this.readFlexibleStringArray(publication, ['authors']);
    const authorsText =
      authors.length > 0
        ? authors.join(', ')
        : this.readString(publication, ['authorNameInRecord']) ?? undefined;

    return this.createHarvestedPublication({
      title,
      doi: this.readString(publication, ['doi']) ?? undefined,
      journal: this.readString(publication, ['sourceTitle']) ?? undefined,
      publishedAt,
      publishedYear,
      authors,
      authorsText,
      volume: this.readString(publication, ['volume']) ?? undefined,
      issue: this.readString(publication, ['issue']) ?? undefined,
      pages: this.readString(publication, ['pages']) ?? undefined,
      pmid: this.readString(publication, ['pmid']) ?? undefined,
      citationCount:
        this.readNumber(publication, ['citationCount']) ?? undefined,
      sourceRecord: {
        platform: 'clarivate_wos',
        sourceId: this.readString(publication, ['uid']) ?? undefined,
        sourceUrl: this.readString(publication, ['recordUrl']) ?? undefined,
        metadata: {
          matchedResearcherId:
            this.readString(publication, ['matchedResearcherId']) ?? undefined,
          matchedWosStandard:
            this.readString(publication, ['matchedWosStandard']) ?? undefined,
          authorNameInRecord:
            this.readString(publication, ['authorNameInRecord']) ?? undefined,
          rawPublication: publication,
        },
      },
    });
  }

  private createHarvestedPublication(input: {
    title: string;
    doi?: string;
    journal?: string;
    publishedAt?: string;
    publishedYear?: number;
    authors?: string[];
    authorsText?: string;
    abstract?: string;
    snippet?: string;
    keywords?: string[];
    publisher?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language?: string;
    pmid?: string;
    citationCount?: number;
    sourceRecord: SourceRecordInput;
  }): HarvestedPublication {
    const title = input.title.trim();
    const normalizedTitle = this.normalizeText(title);
    const journal = input.journal?.trim() || undefined;
    const doi = this.normalizeDoi(input.doi);
    const publishedAt = this.normalizeIsoDate(input.publishedAt);
    const publishedYear =
      input.publishedYear ??
      (publishedAt ? new Date(publishedAt).getUTCFullYear() : undefined);
    const authors = this.mergeAuthorArrays([], input.authors ?? []);
    const authorsText =
      input.authorsText?.trim() ||
      (authors.length > 0 ? authors.join(', ') : undefined);

    return {
      title,
      normalizedTitle,
      doi,
      fingerprint: this.buildFingerprint(normalizedTitle, publishedYear, journal),
      titleYearKey: this.buildTitleYearKey(normalizedTitle, publishedYear),
      journal,
      publishedAt,
      publishedYear,
      authors,
      authorsText,
      abstract: input.abstract?.trim() || undefined,
      snippet: input.snippet?.trim() || undefined,
      keywords: this.mergeStringArrays([], input.keywords ?? []),
      publisher: input.publisher?.trim() || undefined,
      volume: input.volume?.trim() || undefined,
      issue: input.issue?.trim() || undefined,
      pages: input.pages?.trim() || undefined,
      language: input.language?.trim() || undefined,
      pmid: input.pmid?.trim() || undefined,
      citationCount:
        typeof input.citationCount === 'number' &&
        Number.isFinite(input.citationCount)
          ? input.citationCount
          : undefined,
      sourceRecords: this.mergeSourceRecords([input.sourceRecord]),
    };
  }

  private mergeHarvestedPublications(
    items: HarvestedPublication[],
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    const groups: HarvestedPublication[] = [];
    const byDoi = new Map<string, HarvestedPublication>();
    const byFingerprint = new Map<string, HarvestedPublication>();
    const byTitleYear = new Map<string, HarvestedPublication>();

    for (const item of items) {
      const existing = this.findExistingMergeTarget(
        item,
        byDoi,
        byFingerprint,
        byTitleYear,
      );

      if (!existing) {
        const created = this.cloneHarvestedPublication(item);
        groups.push(created);
        this.indexMergedPublication(created, byDoi, byFingerprint, byTitleYear);
        this.logger.log(
          `[Publication Merge] Yeni grup olusturuldu | title="${created.title}" | doi="${created.doi ?? '-'}" | fingerprint="${created.fingerprint}"`,
        );
        continue;
      }

      this.logger.log(
        `[Publication Merge] Mevcut gruba eklendi | title="${item.title}" | mevcutTitle="${existing.title}" | gelenDoi="${item.doi ?? '-'}" | mevcutDoi="${existing.doi ?? '-'}"`,
      );
      this.mergePublicationFields(existing, item, preferredSourceProfiles);
      this.indexMergedPublication(existing, byDoi, byFingerprint, byTitleYear);
    }

    return groups.sort((left, right) => {
      const leftTime = this.sortTimestamp(left);
      const rightTime = this.sortTimestamp(right);
      return rightTime - leftTime || left.title.localeCompare(right.title);
    });
  }

  private findExistingMergeTarget(
    item: HarvestedPublication,
    byDoi: Map<string, HarvestedPublication>,
    byFingerprint: Map<string, HarvestedPublication>,
    byTitleYear: Map<string, HarvestedPublication>,
  ) {
    if (item.doi && byDoi.has(item.doi)) {
      return byDoi.get(item.doi) ?? null;
    }
    if (item.titleYearKey && byTitleYear.has(item.titleYearKey)) {
      return byTitleYear.get(item.titleYearKey) ?? null;
    }
    if (byFingerprint.has(item.fingerprint)) {
      return byFingerprint.get(item.fingerprint) ?? null;
    }
    return null;
  }

  private indexMergedPublication(
    publication: HarvestedPublication,
    byDoi: Map<string, HarvestedPublication>,
    byFingerprint: Map<string, HarvestedPublication>,
    byTitleYear: Map<string, HarvestedPublication>,
  ) {
    if (publication.doi) {
      byDoi.set(publication.doi, publication);
    }
    byFingerprint.set(publication.fingerprint, publication);
    if (publication.titleYearKey) {
      byTitleYear.set(publication.titleYearKey, publication);
    }
  }

  private mergePublicationFields(
    target: HarvestedPublication,
    incoming: HarvestedPublication,
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    target.title =
      this.pickPreferredText(target.title, incoming.title) ?? target.title;
    target.normalizedTitle = this.normalizeText(target.title);
    target.doi = target.doi ?? incoming.doi;
    target.journal = this.pickPreferredText(target.journal, incoming.journal);
    target.publishedAt = this.pickPreferredDate(
      target.publishedAt,
      incoming.publishedAt,
    );
    target.publishedYear = this.pickPreferredYear(
      target.publishedYear,
      incoming.publishedYear,
      target.publishedAt,
      incoming.publishedAt,
    );
    target.authors = this.mergeAuthorArrays(target.authors, incoming.authors);
    target.authorsText = this.pickPreferredText(
      target.authorsText,
      incoming.authorsText,
    );
    target.abstract = this.pickPreferredText(target.abstract, incoming.abstract);
    target.snippet = this.pickPreferredText(target.snippet, incoming.snippet);
    target.keywords = this.mergeStringArrays(target.keywords, incoming.keywords);
    target.publisher = this.pickPreferredText(
      target.publisher,
      incoming.publisher,
    );
    target.volume = this.pickPreferredText(target.volume, incoming.volume);
    target.issue = this.pickPreferredText(target.issue, incoming.issue);
    target.pages = this.pickPreferredText(target.pages, incoming.pages);
    target.language = this.pickPreferredText(target.language, incoming.language);
    target.pmid = this.pickPreferredText(target.pmid, incoming.pmid);
    target.citationCount = this.pickPreferredNumber(
      target.citationCount,
      incoming.citationCount,
    );
    target.sourceRecords = this.selectPreferredSourceRecords(
      this.mergeSourceRecords([...target.sourceRecords, ...incoming.sourceRecords]),
      preferredSourceProfiles,
    );
    target.fingerprint = this.buildFingerprint(
      target.normalizedTitle,
      target.publishedYear,
      target.journal,
    );
    target.titleYearKey = this.buildTitleYearKey(
      target.normalizedTitle,
      target.publishedYear,
    );
    if (!target.authorsText && target.authors.length > 0) {
      target.authorsText = target.authors.join(', ');
    }
  }

  private async upsertPublication(
    author: AuthorRecord,
    publication: HarvestedPublication,
  ) {
    const authorObjectId = author._id;
    const orFilter: Array<PlainObject> = [{ fingerprint: publication.fingerprint }];

    if (publication.doi) {
      orFilter.unshift({ doi: publication.doi });
    }

    if (typeof publication.publishedYear === 'number') {
      orFilter.push({
        normalizedTitle: publication.normalizedTitle,
        publishedYear: publication.publishedYear,
      });
    }

    const filter = orFilter.length === 1 ? orFilter[0] : { $or: orFilter };
    const existingMatches = await this.publicationModel.find(filter).lean().exec();

    if (existingMatches.length > 0) {
      this.logger.log(
        `[Publication Upsert] Eslesen kayitlar bulundu | adet=${existingMatches.length} | gelenTitle="${publication.title}" | gelenDoi="${publication.doi ?? '-'}"`,
      );
      for (const item of existingMatches) {
        this.logger.log(
          `[Publication Upsert] Aday kayit | publicationId="${item._id?.toString?.() ?? ''}" | title="${item.title ?? ''}" | doi="${item.doi ?? '-'}"`,
        );
      }
    } else {
      this.logger.log(
        `[Publication Upsert] Yeni kayit olusturulacak | title="${publication.title}" | doi="${publication.doi ?? '-'}" | fingerprint="${publication.fingerprint}"`,
      );
    }

    let mergedPublication = publication;
    for (const existing of existingMatches) {
      mergedPublication = this.mergeWithStoredPublication(
        existing as unknown as PlainObject,
        mergedPublication,
        author.sourceProfiles,
      );
    }

    mergedPublication.authors = this.mergeAuthorArrays([], mergedPublication.authors);
    mergedPublication.sourceRecords = this.selectPreferredSourceRecords(
      mergedPublication.sourceRecords,
      author.sourceProfiles,
    );
    if (mergedPublication.authors.length > 0) {
      mergedPublication.authorsText = mergedPublication.authors.join(', ');
    }

    const mergedAuthorIds = this.mergeObjectIds(
      existingMatches.flatMap((item) =>
        Array.isArray(item.authorIds)
          ? item.authorIds.map((currentAuthorId) => new Types.ObjectId(currentAuthorId))
          : [],
      ),
      [authorObjectId],
    );

    const canonicalDocument = this.pickCanonicalPublication(
      existingMatches as unknown as PlainObject[],
    );
    const canonicalFilter = canonicalDocument ? { _id: canonicalDocument._id } : filter;

    const saved = await this.publicationModel
      .findOneAndUpdate(
        canonicalFilter,
        {
          $set: {
            title: mergedPublication.title,
            normalizedTitle: mergedPublication.normalizedTitle,
            doi: mergedPublication.doi,
            fingerprint: mergedPublication.fingerprint,
            journal: mergedPublication.journal,
            publishedAt: mergedPublication.publishedAt
              ? new Date(mergedPublication.publishedAt)
              : undefined,
            publishedYear: mergedPublication.publishedYear,
            authors: mergedPublication.authors,
            authorsText: mergedPublication.authorsText,
            abstract: mergedPublication.abstract,
            snippet: mergedPublication.snippet,
            keywords: mergedPublication.keywords,
            publisher: mergedPublication.publisher,
            volume: mergedPublication.volume,
            issue: mergedPublication.issue,
            pages: mergedPublication.pages,
            language: mergedPublication.language,
            pmid: mergedPublication.pmid,
            citationCount: mergedPublication.citationCount,
            sourceRecords: mergedPublication.sourceRecords,
            authorIds: mergedAuthorIds,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      )
      .lean()
      .exec();

    const duplicateIdsToDelete = existingMatches
      .filter(
        (item) =>
          saved?._id &&
          item._id?.toString?.() &&
          item._id.toString() !== saved._id.toString(),
      )
      .map((item) => item._id);

    if (duplicateIdsToDelete.length > 0) {
      this.logger.warn(
        `[Publication Upsert] Duplicate kayitlar siliniyor | canonicalId="${saved?._id?.toString?.() ?? ''}" | silinecekAdet=${duplicateIdsToDelete.length}`,
      );
      await this.publicationModel
        .deleteMany({ _id: { $in: duplicateIdsToDelete } })
        .exec();
    }

    this.logger.log(
      `[Publication Upsert] Kaydedildi | publicationId="${saved?._id?.toString?.() ?? ''}" | title="${saved?.title ?? ''}" | kaynakSayisi=${Array.isArray(saved?.sourceRecords) ? saved.sourceRecords.length : 0}`,
    );

    return saved;
  }

  private pickCanonicalPublication(existingMatches: PlainObject[]) {
    if (existingMatches.length === 0) {
      return null;
    }

    return [...existingMatches].sort((left, right) => {
      const leftScore = this.publicationQualityScore(left);
      const rightScore = this.publicationQualityScore(right);
      return rightScore - leftScore;
    })[0];
  }

  private publicationQualityScore(item: PlainObject) {
    let score = 0;

    if (this.readString(item, ['doi'])) {
      score += 100;
    }
    if (this.readString(item, ['pmid'])) {
      score += 20;
    }

    const sourceRecordCount = Array.isArray(item.sourceRecords)
      ? item.sourceRecords.length
      : 0;
    score += sourceRecordCount * 10;

    const authorCount = Array.isArray(item.authors) ? item.authors.length : 0;
    score += authorCount * 2;

    if (this.readString(item, ['abstract'])) {
      score += 5;
    }
    if (this.readString(item, ['snippet'])) {
      score += 2;
    }

    return score;
  }

  private mergeWithStoredPublication(
    existing: PlainObject,
    incoming: HarvestedPublication,
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    const base = this.mapStoredPublicationToHarvested(existing);
    if (!base) {
      return incoming;
    }

    this.mergePublicationFields(base, incoming, preferredSourceProfiles);
    return base;
  }

  private mapStoredPublicationToHarvested(
    existing: PlainObject,
  ): HarvestedPublication | null {
    const title = this.readString(existing, ['title']);
    if (!title) {
      return null;
    }

    const normalizedTitle =
      this.readString(existing, ['normalizedTitle']) ?? this.normalizeText(title);
    const publishedAtRaw = existing.publishedAt;
    const publishedAt =
      publishedAtRaw instanceof Date
        ? publishedAtRaw.toISOString()
        : typeof publishedAtRaw === 'string'
          ? this.normalizeIsoDate(publishedAtRaw)
          : undefined;
    const publishedYear =
      this.readNumber(existing, ['publishedYear']) ||
      (publishedAt ? new Date(publishedAt).getUTCFullYear() : undefined);

    return {
      title,
      normalizedTitle,
      doi: this.normalizeDoi(this.readString(existing, ['doi'])),
      fingerprint: this.buildFingerprint(
        normalizedTitle,
        publishedYear,
        this.readString(existing, ['journal']) ?? undefined,
      ),
      titleYearKey: this.buildTitleYearKey(normalizedTitle, publishedYear),
      journal: this.readString(existing, ['journal']) ?? undefined,
      publishedAt,
      publishedYear,
      authors: this.readFlexibleStringArray(existing, ['authors']),
      authorsText: this.readString(existing, ['authorsText']) ?? undefined,
      abstract: this.readString(existing, ['abstract']) ?? undefined,
      snippet: this.readString(existing, ['snippet']) ?? undefined,
      keywords: this.readFlexibleStringArray(existing, ['keywords']),
      publisher: this.readString(existing, ['publisher']) ?? undefined,
      volume: this.readString(existing, ['volume']) ?? undefined,
      issue: this.readString(existing, ['issue']) ?? undefined,
      pages: this.readString(existing, ['pages']) ?? undefined,
      language: this.readString(existing, ['language']) ?? undefined,
      pmid: this.readString(existing, ['pmid']) ?? undefined,
      citationCount: this.readNumber(existing, ['citationCount']) ?? undefined,
      sourceRecords: this.mapStoredSourceRecords(existing.sourceRecords),
    };
  }

  private mapStoredSourceRecords(raw: unknown): SourceRecordInput[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return this.mergeSourceRecords(
      raw
        .filter(
          (item): item is PlainObject =>
            typeof item === 'object' && item !== null && !Array.isArray(item),
        )
        .map((item) => ({
          platform: this.readString(item, ['platform']) ?? 'unknown',
          sourceId: this.readString(item, ['sourceId']) ?? undefined,
          sourceUrl: this.readString(item, ['sourceUrl']) ?? undefined,
          metadata: this.readObject(item, ['metadata']) ?? undefined,
        })),
    );
  }

  private parsePubmedJournalCitation(citation?: string | null) {
    const cleaned = citation?.replace(/\s+/g, ' ').trim() ?? '';
    const doi =
      this.normalizeDoi(
        this.extractFirstMatch(cleaned, /\bdoi:\s*(10\.\S+?)(?:\s|$)/i),
      ) ?? undefined;

    const dateMatch = cleaned.match(
      /^(.+?)\.\s+(\d{4})(?:\s+([A-Za-z]{3,9}))?(?:\s+(\d{1,2}))?(?:;|$)/,
    );

    if (!dateMatch) {
      return {
        doi,
        journal: undefined,
        publishedAt: undefined,
        publishedYear: undefined,
        volume: undefined,
        issue: undefined,
        pages: undefined,
      };
    }

    const journal = dateMatch[1]?.trim() || undefined;
    const yearValue = Number(dateMatch[2]);
    const publishedYear = Number.isInteger(yearValue) ? yearValue : undefined;
    const monthToken = dateMatch[3]?.trim().toLowerCase() ?? '';
    const dayToken = dateMatch[4]?.trim() ?? '';
    const month = monthToken ? PUBMED_MONTHS[monthToken] : undefined;
    const day =
      dayToken && Number.isInteger(Number(dayToken))
        ? String(dayToken).padStart(2, '0')
        : undefined;
    const publishedAt =
      publishedYear && month && day
        ? `${publishedYear}-${month}-${day}T00:00:00.000Z`
        : publishedYear && month
          ? `${publishedYear}-${month}-01T00:00:00.000Z`
          : publishedYear
            ? `${publishedYear}-01-01T00:00:00.000Z`
            : undefined;

    const volumeIssuePagesMatch = cleaned.match(
      /;\s*([A-Za-z0-9]+)(?:\(([^)]+)\))?(?::([A-Za-z0-9\-eE]+))?/,
    );

    return {
      doi,
      journal,
      publishedAt,
      publishedYear,
      volume: volumeIssuePagesMatch?.[1]?.trim() || undefined,
      issue: volumeIssuePagesMatch?.[2]?.trim() || undefined,
      pages: volumeIssuePagesMatch?.[3]?.trim() || undefined,
    };
  }

  private async enrichSerpapiScholarPublications(
    authorId: string,
    publications: PlainObject[],
  ) {
    return this.mapWithConcurrency(
      publications,
      Math.max(1, Math.min(this.scholarDoiEnrichmentConcurrency, 6)),
      async (publication) =>
        this.enrichSerpapiScholarPublication(authorId, publication),
    );
  }

  private async enrichSerpapiScholarPublication(
    authorId: string,
    publication: PlainObject,
  ) {
    const enriched: PlainObject = { ...publication };
    const existingDoi = this.normalizeDoi(this.readString(publication, ['doi']));

    if (existingDoi) {
      enriched.doi = existingDoi;
      return enriched;
    }

    const citationIdRaw = this.readString(publication, [
      'citationId',
      'citation_id',
    ]);
    const citationId = citationIdRaw
      ? this.buildScholarCitationId(authorId, citationIdRaw)
      : undefined;

    if (citationId) {
      try {
        const detail = await this.serpapiService.getAuthorPublicationDetail({
          authorId,
          citationId,
          hl: 'tr',
        });
        const detailEnrichment = this.extractScholarCitationEnrichment(
          detail.citation ?? null,
        );
        Object.assign(enriched, detailEnrichment);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Bilinmeyen Scholar detail hatasi';
        this.logger.warn(
          `[Publication Sync][serpapi_scholar] Scholar detail DOI enrichment basarisiz | authorId="${authorId}" | citationId="${citationId}" | hata="${message}"`,
        );
      }
    }

    const resolvedDoi = this.normalizeDoi(this.readString(enriched, ['doi']));
    if (resolvedDoi) {
      enriched.doi = resolvedDoi;
      return enriched;
    }

    const crossrefMatch = await this.lookupCrossrefWorkForScholarPublication(
      enriched,
    );
    if (crossrefMatch?.doi) {
      enriched.doi = crossrefMatch.doi;

      if (!this.readString(enriched, ['journal']) && crossrefMatch.journal) {
        enriched.journal = crossrefMatch.journal;
      }
      if (
        !this.readNumber(enriched, ['publishedYear']) &&
        crossrefMatch.publishedYear
      ) {
        enriched.publishedYear = crossrefMatch.publishedYear;
      }
    }

    return enriched;
  }

  private extractScholarCitationEnrichment(
    citation:
      | {
          title?: string | null;
          link?: string | null;
          authors?: string | null;
          publicationDate?: string | null;
          journal?: string | null;
          volume?: string | null;
          issue?: string | null;
          pages?: string | null;
          publisher?: string | null;
          description?: string | null;
          resources?: Array<{
            title?: string | null;
            link?: string | null;
            fileFormat?: string | null;
          }>;
        }
      | null
      | undefined,
  ): PlainObject {
    if (!citation) {
      return {};
    }

    const date = this.parseScholarPublicationDate(citation.publicationDate);
    const doi = this.extractDoiFromScholarCitationDetail(citation);

    return {
      doi,
      journal: citation.journal?.trim() || undefined,
      publishedAt: date.publishedAt,
      publishedYear: date.publishedYear,
      volume: citation.volume?.trim() || undefined,
      issue: citation.issue?.trim() || undefined,
      pages: citation.pages?.trim() || undefined,
      publisher: citation.publisher?.trim() || undefined,
      abstract: citation.description?.trim() || undefined,
    };
  }

  private extractDoiFromScholarCitationDetail(
    citation:
      | {
          link?: string | null;
          description?: string | null;
          resources?: Array<{
            link?: string | null;
          }>;
        }
      | null
      | undefined,
  ) {
    if (!citation) {
      return undefined;
    }

    const directCandidates = [
      citation.link ?? undefined,
      citation.description ?? undefined,
      ...(citation.resources ?? []).map((item) => item.link ?? undefined),
    ];

    for (const candidate of directCandidates) {
      const doi = this.normalizeDoi(candidate);
      if (doi) {
        return doi;
      }
    }

    return undefined;
  }

  private parseScholarPublicationDate(value?: string | null) {
    const raw = value?.trim();
    if (!raw) {
      return {
        publishedAt: undefined,
        publishedYear: undefined,
      };
    }

    const parts = raw
      .split(/[/-]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const year = Number(parts[0]);

    if (!Number.isInteger(year) || year < 1000) {
      return {
        publishedAt: undefined,
        publishedYear: undefined,
      };
    }

    const month = Number(parts[1]);
    const day = Number(parts[2]);

    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      const safeDay =
        Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
      return {
        publishedAt: `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}T00:00:00.000Z`,
        publishedYear: year,
      };
    }

    return {
      publishedAt: `${year}-01-01T00:00:00.000Z`,
      publishedYear: year,
    };
  }

  private buildScholarCitationId(authorId: string, citationId: string) {
    const trimmedAuthorId = authorId.trim();
    const trimmedCitationId = citationId.trim();

    if (!trimmedAuthorId) {
      return trimmedCitationId;
    }

    if (
      trimmedCitationId.includes(':') &&
      trimmedCitationId.startsWith(`${trimmedAuthorId}:`)
    ) {
      return trimmedCitationId;
    }

    if (trimmedCitationId.includes(':')) {
      return trimmedCitationId;
    }

    return `${trimmedAuthorId}:${trimmedCitationId}`;
  }

  private buildScholarCitationUrl(authorId: string, citationId: string) {
    const resolvedCitationId = this.buildScholarCitationId(authorId, citationId);
    return `https://scholar.google.com/citations?view_op=view_citation&user=${encodeURIComponent(authorId)}&citation_for_view=${encodeURIComponent(resolvedCitationId)}`;
  }

  private async lookupCrossrefWorkForScholarPublication(
    publication: PlainObject,
  ): Promise<CrossrefWorkMatch | null> {
    const title = this.readString(publication, ['title']);
    if (!title) {
      return null;
    }

    const authors = this.readFlexibleStringArray(publication, ['authors']);
    const authorsText =
      this.readString(publication, ['authorsText', 'authors']) ?? undefined;
    const publishedYear =
      this.readNumber(publication, ['publishedYear', 'year']) ?? undefined;
    const journal =
      this.readString(publication, ['journal', 'publication']) ?? undefined;
    const firstAuthorFamilyName =
      this.extractFirstAuthorFamilyName(authors[0] ?? authorsText);

    const cacheKey = [
      this.normalizeText(title),
      firstAuthorFamilyName ?? '',
      publishedYear ?? '',
      this.normalizeText(journal ?? ''),
    ].join('|');
    const cached = this.getCachedCrossrefMatch(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const queryParts = [
      title,
      firstAuthorFamilyName,
      publishedYear ? String(publishedYear) : undefined,
      journal,
    ].filter((value): value is string => Boolean(value?.trim()));

    if (queryParts.length === 0) {
      this.setCachedCrossrefMatch(cacheKey, null);
      return null;
    }

    const params = new URLSearchParams({
      rows: '5',
      select: 'DOI,title,author,issued,published-print,published-online,container-title,URL,score',
      'query.bibliographic': queryParts.join(' '),
    });
    if (this.crossrefMailto) {
      params.set('mailto', this.crossrefMailto);
    }

    const url = `${this.crossrefBaseUrl}?${params.toString()}`;
    const json = await this.fetchCrossrefJson(url);
    if (!json) {
      this.setCachedCrossrefMatch(cacheKey, null);
      return null;
    }

    const message =
      json.message && typeof json.message === 'object' && !Array.isArray(json.message)
        ? (json.message as PlainObject)
        : null;
    const items = Array.isArray(message?.items)
      ? (message?.items as PlainObject[])
      : [];

    const best = items
      .map((item) =>
        this.scoreCrossrefCandidate(item, {
          title,
          firstAuthorFamilyName,
          publishedYear,
          journal,
        }),
      )
      .sort((left, right) => right.score - left.score)[0];

    const match = best && this.isAcceptableCrossrefCandidate(best) ? best : null;
    this.setCachedCrossrefMatch(cacheKey, match);
    return match;
  }

  private scoreCrossrefCandidate(
    candidate: PlainObject,
    expected: {
      title: string;
      firstAuthorFamilyName?: string;
      publishedYear?: number;
      journal?: string;
    },
  ): CrossrefWorkMatch {
    const doi = this.normalizeDoi(this.readString(candidate, ['DOI', 'doi']));
    const title =
      this.readFlexibleStringArray(candidate, ['title', 'original-title'])[0] ??
      undefined;
    const journal =
      this.readFlexibleStringArray(candidate, [
        'container-title',
        'short-container-title',
      ])[0] ?? undefined;
    const sourceUrl = this.readString(candidate, ['URL', 'url']) ?? undefined;
    const apiScore = this.readNumber(candidate, ['score']) ?? 0;
    const publishedYear = this.extractCrossrefPublishedYear(candidate);
    const candidateFirstAuthor = this.extractCrossrefFirstAuthorFamilyName(candidate);

    const normalizedExpectedTitle = this.normalizeText(expected.title);
    const normalizedCandidateTitle = this.normalizeText(title ?? '');
    const titleTokenScore = this.computeTokenOverlapScore(
      normalizedExpectedTitle,
      normalizedCandidateTitle,
    );

    let score = titleTokenScore;

    if (normalizedExpectedTitle && normalizedExpectedTitle === normalizedCandidateTitle) {
      score += 40;
    }

    if (
      expected.publishedYear &&
      publishedYear &&
      expected.publishedYear === publishedYear
    ) {
      score += 18;
    } else if (
      expected.publishedYear &&
      publishedYear &&
      Math.abs(expected.publishedYear - publishedYear) === 1
    ) {
      score += 6;
    }

    if (
      expected.firstAuthorFamilyName &&
      candidateFirstAuthor &&
      expected.firstAuthorFamilyName === candidateFirstAuthor
    ) {
      score += 18;
    }

    if (expected.journal && journal) {
      const journalScore = this.computeTokenOverlapScore(
        this.normalizeText(expected.journal),
        this.normalizeText(journal),
      );
      score += Math.min(12, Math.round(journalScore / 4));
    }

    score += Math.min(10, Math.round(apiScore));

    return {
      doi: doi ?? '',
      score,
      title,
      sourceUrl,
      journal,
      publishedYear,
    };
  }

  private isAcceptableCrossrefCandidate(candidate: CrossrefWorkMatch) {
    if (!candidate.doi) {
      return false;
    }

    return candidate.score >= 80;
  }

  private computeTokenOverlapScore(left: string, right: string) {
    if (!left || !right) {
      return 0;
    }

    const leftTokens = left.split(' ').filter(Boolean);
    const rightTokens = right.split(' ').filter(Boolean);
    if (leftTokens.length === 0 || rightTokens.length === 0) {
      return 0;
    }

    const rightSet = new Set(rightTokens);
    let shared = 0;
    for (const token of leftTokens) {
      if (rightSet.has(token)) {
        shared += 1;
      }
    }

    return Math.round((shared / Math.max(leftTokens.length, rightTokens.length)) * 100);
  }

  private extractFirstAuthorFamilyName(value?: string | null) {
    const raw = value?.trim();
    if (!raw) {
      return undefined;
    }

    const normalized = raw.replace(/[.;]+$/g, '').trim();
    if (!normalized) {
      return undefined;
    }

    const commaParts = normalized.split(',').map((item) => item.trim());
    if (commaParts.length >= 2 && commaParts[0]) {
      return this.normalizeText(commaParts[0]);
    }

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return this.normalizeText(parts[0]);
    }

    const lastToken = parts[parts.length - 1] ?? '';
    const firstToken = parts[0] ?? '';
    const preferred =
      lastToken.length > 1 && !/^[A-Z]\.?$/i.test(lastToken)
        ? lastToken
        : firstToken;

    const familyName = this.normalizeText(preferred);
    return familyName || undefined;
  }

  private extractCrossrefFirstAuthorFamilyName(candidate: PlainObject) {
    const authorsRaw = candidate.author;
    if (!Array.isArray(authorsRaw) || authorsRaw.length === 0) {
      return undefined;
    }

    const firstAuthor = authorsRaw[0];
    if (!firstAuthor || typeof firstAuthor !== 'object' || Array.isArray(firstAuthor)) {
      return undefined;
    }

    const family = this.readString(firstAuthor as PlainObject, ['family']);
    return family ? this.normalizeText(family) : undefined;
  }

  private extractCrossrefPublishedYear(candidate: PlainObject) {
    const fields = [
      'published-print',
      'published-online',
      'issued',
      'published',
      'created',
    ];

    for (const field of fields) {
      const value = candidate[field];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const dateParts = (value as PlainObject)['date-parts'];
      if (!Array.isArray(dateParts) || dateParts.length === 0) {
        continue;
      }

      const first = dateParts[0];
      if (!Array.isArray(first) || first.length === 0) {
        continue;
      }

      const year = Number(first[0]);
      if (Number.isInteger(year) && year >= 1000) {
        return year;
      }
    }

    return undefined;
  }

  private async fetchCrossrefJson(url: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.crossrefTimeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.warn(
          `[Publication Sync][crossref] DOI lookup basarisiz | status=${response.status} | url="${url}"`,
        );
        return null;
      }

      return (await response.json()) as PlainObject;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Bilinmeyen Crossref hatasi';
      this.logger.warn(
        `[Publication Sync][crossref] DOI lookup exception | hata="${message}" | url="${url}"`,
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getCachedCrossrefMatch(cacheKey: string) {
    const cached = this.crossrefCache.get(cacheKey);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= Date.now()) {
      this.crossrefCache.delete(cacheKey);
      return undefined;
    }

    return cached.value;
  }

  private setCachedCrossrefMatch(
    cacheKey: string,
    value: CrossrefWorkMatch | null,
  ) {
    this.crossrefCache.set(cacheKey, {
      expiresAt: Date.now() + this.crossrefCacheTtlMs,
      value,
    });
  }

  private findSourceProfile(author: AuthorRecord, platforms: string[]) {
    const requestedPlatforms = new Set(
      platforms.map((platform) => this.getCanonicalPlatformKey(platform)),
    );

    return (author.sourceProfiles ?? []).find((profile) =>
      requestedPlatforms.has(this.getCanonicalPlatformKey(profile.platform)),
    );
  }

  private mergeSourceRecords(records: SourceRecordInput[]) {
    const byKey = new Map<string, SourceRecordInput>();

    for (const rawRecord of records) {
      const record = this.normalizeSourceRecord(rawRecord);
      const key = this.buildSourceRecordKey(record);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, record);
        continue;
      }

      existing.sourceId = existing.sourceId ?? record.sourceId;
      existing.sourceUrl = existing.sourceUrl ?? record.sourceUrl;
      existing.metadata = this.mergeMetadata(existing.metadata, record.metadata);
    }

    return Array.from(byKey.values());
  }

  private selectPreferredSourceRecords(
    records: SourceRecordInput[],
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    const byPlatform = new Map<string, SourceRecordInput>();

    for (const rawRecord of records) {
      const record = this.normalizeSourceRecord(rawRecord);
      const key = this.getCanonicalPlatformKey(record.platform);
      const existing = byPlatform.get(key);

      if (!existing) {
        byPlatform.set(key, record);
        continue;
      }

      byPlatform.set(
        key,
        this.pickPreferredSourceRecord(
          existing,
          record,
          preferredSourceProfiles,
        ),
      );
    }

    return Array.from(byPlatform.values());
  }

  private normalizeSourceRecord(record: SourceRecordInput): SourceRecordInput {
    return {
      platform: record.platform.trim(),
      sourceId: record.sourceId?.trim() || undefined,
      sourceUrl: record.sourceUrl?.trim() || undefined,
      metadata: this.clonePlainObject(record.metadata),
    };
  }

  private buildSourceRecordKey(record: SourceRecordInput) {
    const metadataKey =
      this.readString(record.metadata ?? {}, ['pmid', 'title', 'doi']) ?? '';
    return [
      record.platform.trim(),
      record.sourceId?.trim() ?? '',
      record.sourceUrl?.trim() ?? '',
      metadataKey,
    ].join('|');
  }

  private pickPreferredSourceRecord(
    current: SourceRecordInput,
    incoming: SourceRecordInput,
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    const currentScore = this.sourceRecordScore(current, preferredSourceProfiles);
    const incomingScore = this.sourceRecordScore(incoming, preferredSourceProfiles);

    if (incomingScore > currentScore) {
      return {
        platform: incoming.platform,
        sourceId: incoming.sourceId ?? current.sourceId,
        sourceUrl: incoming.sourceUrl ?? current.sourceUrl,
        metadata: this.mergeMetadata(
          this.clonePlainObject(incoming.metadata),
          current.metadata,
        ),
      };
    }

    return {
      platform: current.platform,
      sourceId: current.sourceId ?? incoming.sourceId,
      sourceUrl: current.sourceUrl ?? incoming.sourceUrl,
      metadata: this.mergeMetadata(
        this.clonePlainObject(current.metadata),
        incoming.metadata,
      ),
    };
  }

  private sourceRecordScore(
    record: SourceRecordInput,
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    let score = 0;

    if (record.sourceUrl) {
      score += 20;
    }
    if (record.sourceId) {
      score += 14;
    }
    if (record.metadata) {
      score += 6;
    }

    const metadataScore = this.readNumber(record.metadata ?? {}, ['score']);
    if (metadataScore != null) {
      score += metadataScore;
    }

    const rawPublication =
      record.metadata?.rawPublication &&
      typeof record.metadata.rawPublication === 'object' &&
      !Array.isArray(record.metadata.rawPublication)
        ? (record.metadata.rawPublication as PlainObject)
        : null;

    if (rawPublication) {
      if (this.readString(rawPublication, ['title'])) {
        score += 4;
      }
      if (this.readString(rawPublication, ['authors'])) {
        score += 2;
      }
    }

    for (const profile of preferredSourceProfiles ?? []) {
      if (this.sourceRecordMatchesProfile(record, profile)) {
        score += 250;
      }
    }

    return score;
  }

  private sourceRecordMatchesProfile(
    record: SourceRecordInput,
    profile: AuthorSourceProfile,
  ) {
    if (
      this.getCanonicalPlatformKey(record.platform) !==
      this.getCanonicalPlatformKey(profile.platform)
    ) {
      return false;
    }

    const authorId = profile.externalAuthorId?.trim();
    if (!authorId) {
      return false;
    }

    const metadata = record.metadata ?? {};
    const rawPublication =
      metadata.rawPublication &&
      typeof metadata.rawPublication === 'object' &&
      !Array.isArray(metadata.rawPublication)
        ? (metadata.rawPublication as PlainObject)
        : {};
    const authorDetailSummary =
      metadata.authorDetailSummary &&
      typeof metadata.authorDetailSummary === 'object' &&
      !Array.isArray(metadata.authorDetailSummary)
        ? (metadata.authorDetailSummary as PlainObject)
        : {};

    return [
      record.sourceId?.trim() ?? '',
      record.sourceUrl?.trim() ?? '',
      this.readString(rawPublication, ['citationId', 'serpapiLink']) ?? '',
      this.readString(rawPublication, ['matchedResearcherId']) ?? '',
      this.readString(rawPublication, ['matchedWosStandard']) ?? '',
      this.readString(authorDetailSummary, ['authorId']) ?? '',
    ].some((value) => value.includes(authorId));
  }

  private getCanonicalPlatformKey(platform: string) {
    const normalized = platform.trim().toLowerCase();

    if (['scraper_scopus', 'scopus_scraper'].includes(normalized)) {
      return 'scopus';
    }
    if (['serpapi_scholar', 'google_scholar'].includes(normalized)) {
      return 'google_scholar';
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
    if (this.getCanonicalPlatformKey(platform) === 'clarivate_wos') {
      return 'Web Of Science';
    }

    return platform;
  }

  private mergeMetadata(
    current?: PlainObject,
    incoming?: PlainObject,
  ): PlainObject | undefined {
    const currentValue = this.clonePlainObject(current);
    const incomingValue = this.clonePlainObject(incoming);

    if (!currentValue) {
      return incomingValue;
    }
    if (!incomingValue) {
      return currentValue;
    }

    const merged: PlainObject = { ...currentValue };

    for (const [key, value] of Object.entries(incomingValue)) {
      const existing = merged[key];

      if (!this.isMeaningfulValue(existing)) {
        merged[key] = value;
        continue;
      }

      if (!this.isMeaningfulValue(value)) {
        continue;
      }

      if (Array.isArray(existing) && Array.isArray(value)) {
        merged[key] = this.mergeUnknownArrays(existing, value);
        continue;
      }

      if (this.isPlainObject(existing) && this.isPlainObject(value)) {
        merged[key] = this.mergeMetadata(
          existing as PlainObject,
          value as PlainObject,
        );
        continue;
      }

      if (typeof existing === 'string' && typeof value === 'string') {
        merged[key] = this.pickPreferredText(existing, value);
        continue;
      }

      if (typeof existing === 'number' && typeof value === 'number') {
        merged[key] = Math.max(existing, value);
        continue;
      }
    }

    return merged;
  }

  private mergeUnknownArrays(current: unknown[], incoming: unknown[]) {
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const item of [...current, ...incoming]) {
      const key = this.serializeUnknown(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  private serializeUnknown(value: unknown) {
    if (typeof value === 'string') {
      return `str:${value}`;
    }
    if (typeof value === 'number') {
      return `num:${value}`;
    }
    if (typeof value === 'boolean') {
      return `bool:${value}`;
    }
    if (value === null || value === undefined) {
      return 'nil';
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private cloneHarvestedPublication(
    publication: HarvestedPublication,
  ): HarvestedPublication {
    return {
      ...publication,
      authors: [...publication.authors],
      keywords: [...publication.keywords],
      sourceRecords: this.mergeSourceRecords(publication.sourceRecords),
    };
  }

  private logNormalizedPublication(
    platform: string,
    publication: HarvestedPublication,
  ) {
    this.logger.log(
      `[Publication Sync][${platform}] Normalize edildi | title="${publication.title}" | doi="${publication.doi ?? '-'}" | yil=${publication.publishedYear ?? '-'} | journal="${publication.journal ?? '-'}"`,
    );
  }

  private debugConsole(platform: string, message: string, payload?: unknown) {
    const prefix = `[Publication Debug][${platform}] ${message}`;
    if (typeof payload === 'undefined') {
      console.log(prefix);
      return;
    }

    console.log(prefix);
    console.dir(payload, {
      depth: 6,
      maxArrayLength: 50,
      breakLength: 140,
    });
  }

  private buildScopusPublicationUnavailableReason(
    detailParsed: PlainObject | null,
    totalDocuments?: number,
  ) {
    const publicationSummary = detailParsed
      ? this.readObject(detailParsed, ['publicationSummary'])
      : null;
    const panelMessage = publicationSummary
      ? this.readString(publicationSummary, ['documentPanelMessage'])
      : null;
    const loginRequired =
      detailParsed && detailParsed.loginRequired === true;
    const previewMode =
      (detailParsed?.previewMode as boolean | undefined) === true ||
      (publicationSummary?.previewMode as boolean | undefined) === true;
    const limitedAccess =
      (publicationSummary?.limitedAccess as boolean | undefined) === true;

    if (loginRequired) {
      return 'Scopus document listesi giris istiyor.';
    }

    if (previewMode && limitedAccess) {
      const suffix =
        typeof totalDocuments === 'number' && totalDocuments > 0
          ? ` Toplam document sayisi ${totalDocuments} olarak gorunuyor.`
          : '';
      return `Scopus Preview modunda document listesi sinirli erisim nedeniyle acilmadi.${suffix}`;
    }

    if (panelMessage) {
      return `Scopus document panel mesaji: ${panelMessage}`;
    }

    if (typeof totalDocuments === 'number' && totalDocuments > 0) {
      return `Scopus author detail ${totalDocuments} document gosteriyor ama parse edilebilir publication karti bulunamadi.`;
    }

    return 'Scopus author detail publication listesi bos dondu.';
  }

  private resolveScopusPublicationEmptyStatus(
    detailParsed: PlainObject | null,
    totalDocuments?: number,
  ): ProviderSyncStatus {
    const publicationSummary = detailParsed
      ? this.readObject(detailParsed, ['publicationSummary'])
      : null;
    const previewMode =
      (detailParsed?.previewMode as boolean | undefined) === true ||
      (publicationSummary?.previewMode as boolean | undefined) === true;
    const limitedAccess =
      (publicationSummary?.limitedAccess as boolean | undefined) === true;
    const loginRequired =
      detailParsed && detailParsed.loginRequired === true;

    if (loginRequired || (previewMode && limitedAccess)) {
      return 'skipped';
    }

    if (typeof totalDocuments === 'number' && totalDocuments <= 0) {
      return 'ok';
    }

    return 'unsupported';
  }

  private buildSkippedProviderResult(
    platform: string,
    reason?: string,
  ): ProviderSyncResult {
    return {
      platform,
      status: 'skipped',
      totalRaw: 0,
      totalNormalized: 0,
      reason,
      publications: [],
    };
  }

  private buildErrorProviderResult(
    platform: string,
    error: unknown,
  ): ProviderSyncResult {
    const reason =
      error instanceof Error ? error.message : 'Bilinmeyen provider hatasi';
    this.logger.warn(
      `[Publication Sync][${platform}] Tarama hatasi | mesaj="${reason}"`,
    );
    return {
      platform,
      status: 'error',
      totalRaw: 0,
      totalNormalized: 0,
      reason,
      publications: [],
    };
  }

  private buildDbHitProviderResults(author: AuthorRecord) {
    const availablePlatforms = [
      'serpapi_scholar',
      'trdizin',
      'scraper_pubmed',
      'clarivate_wos',
      'scraper_scopus',
    ];

    return availablePlatforms.map((platform) => {
      const profile = this.findSourceProfile(author, [
        platform,
        platform === 'scraper_scopus' ? 'scopus_scraper' : platform,
      ]);

      return {
        platform,
        status: 'skipped' as const,
        totalRaw: 0,
        totalNormalized: 0,
        reason: profile
          ? 'Veritabaninda kayit bulundugu icin provider taramasi yapilmadi.'
          : 'Kaynak profili bulunmadigi icin provider taramasi yapilmadi.',
      };
    });
  }

  private formatProviderResultOutput(
    result: Pick<
      ProviderSyncResult,
      'platform' | 'status' | 'totalRaw' | 'totalNormalized' | 'reason'
    >,
  ) {
    const platformKey = result.platform;
    const platformLabel = this.getPlatformDisplayName(platformKey);

    return {
      platform: platformLabel,
      platformKey,
      platformLabel,
      status: result.status,
      totalRaw: result.totalRaw,
      totalNormalized: result.totalNormalized,
      reason: result.reason,
    };
  }

  private formatPublicationOutput(
    publication: PlainObject,
    preferredSourceProfiles?: AuthorSourceProfile[],
  ) {
    const authorsText = this.readString(publication, ['authorsText']) ?? undefined;
    const authorCandidates = this.readFlexibleStringArray(publication, ['authors']);
    const authors =
      authorCandidates.length > 0
        ? this.mergeAuthorArrays([], authorCandidates)
        : this.splitAuthorText(authorsText);

    return {
      ...publication,
      authors,
      authorsText: authors.length > 0 ? authors.join(', ') : authorsText,
      sourceRecords: this.selectPreferredSourceRecords(
        this.mapStoredSourceRecords(publication.sourceRecords),
        preferredSourceProfiles,
      ).map((record) => this.formatSourceRecordOutput(record)),
    };
  }

  private matchesClarivatePublicationContext(
    author: AuthorRecord,
    publication: PlainObject,
    profile?: AuthorSourceProfile,
  ) {
    const matchedAffiliations = this.readFlexibleStringArray(publication, [
      'matchedAffiliations',
    ]);
    if (matchedAffiliations.length === 0) {
      return !this.isAmbiguousClarivateProfile(profile);
    }

    const preferredAffiliations = this.getClarivateAffiliationPreferences(author);
    const normalizedAffiliations = matchedAffiliations.map((item) =>
      this.normalizeText(item),
    );
    const universityMatched = author.university?.trim()
      ? normalizedAffiliations.some((item) =>
          this.hasStrongClarivateAffiliationOverlap(item, author.university ?? ''),
        )
      : false;
    const affiliationMatched =
      preferredAffiliations.length > 0
        ? preferredAffiliations.some((preference) =>
            normalizedAffiliations.some((item) =>
              this.hasStrongClarivateAffiliationOverlap(item, preference),
            ),
          )
        : false;
    const cityMatched = author.city?.trim()
      ? normalizedAffiliations.some((item) =>
          item.includes(this.normalizeText(author.city ?? '')),
        )
      : false;
    const countryMatched = author.country?.trim()
      ? normalizedAffiliations.some((item) =>
          item.includes(this.normalizeText(author.country ?? '')),
        )
      : false;

    if (universityMatched || affiliationMatched) {
      return true;
    }

    if (author.city?.trim() && author.country?.trim()) {
      return cityMatched && countryMatched;
    }

    if (author.country?.trim()) {
      return countryMatched;
    }

    return !this.isAmbiguousClarivateProfile(profile);
  }

  private getClarivateAffiliationPreferences(author: AuthorRecord) {
    return this.mergeStringArrays(
      [],
      [
        author.university ?? '',
        ...(author.affiliations ?? []),
        ...(author.institutionAliases ?? []),
        ...(author.parsedAffiliations ?? []).flatMap((item) => [
          this.readString(item, ['raw']) ?? '',
          this.readString(item, ['university']) ?? '',
          this.readString(item, ['institutionCanonicalName']) ?? '',
        ]),
      ].filter(Boolean),
    );
  }

  private isAmbiguousClarivateProfile(profile?: AuthorSourceProfile) {
    if (!profile?.externalAuthorId?.trim()) {
      return true;
    }

    const value = profile.externalAuthorId.trim();
    if (/[A-Z]{2,}-?\d/i.test(value)) {
      return false;
    }
    if (/,/.test(value)) {
      return false;
    }

    return true;
  }

  private hasStrongClarivateAffiliationOverlap(
    candidateText: string,
    preferredText: string,
  ) {
    const normalizedCandidate = this.normalizeText(candidateText);
    const normalizedPreferred = this.normalizeText(preferredText);

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
      .filter((token) => token.length > 2);
    const preferredTokens = normalizedPreferred
      .split(' ')
      .filter((token) => token.length > 2);

    if (candidateTokens.length === 0 || preferredTokens.length === 0) {
      return false;
    }

    const candidateSet = new Set(candidateTokens);
    const shared = preferredTokens.filter((token) => candidateSet.has(token));
    return shared.length >= Math.min(2, preferredTokens.length);
  }

  private formatSourceRecordOutput(record: SourceRecordInput) {
    const platformKey = record.platform.trim();
    const platformLabel = this.getPlatformDisplayName(platformKey);

    return {
      ...record,
      platform: platformLabel,
      platformKey,
      platformLabel,
    };
  }

  private buildClarivatePublishedAt(
    publishedYear?: number,
    publishMonth?: string | null,
  ) {
    if (!publishedYear || !Number.isFinite(publishedYear)) {
      return undefined;
    }

    const normalizedMonth = publishMonth?.trim().toLowerCase();
    const monthMap: Record<string, string> = {
      jan: '01',
      january: '01',
      feb: '02',
      february: '02',
      mar: '03',
      march: '03',
      apr: '04',
      april: '04',
      may: '05',
      jun: '06',
      june: '06',
      jul: '07',
      july: '07',
      aug: '08',
      august: '08',
      sep: '09',
      sept: '09',
      september: '09',
      oct: '10',
      october: '10',
      nov: '11',
      november: '11',
      dec: '12',
      december: '12',
    };

    let month = normalizedMonth ? monthMap[normalizedMonth] : undefined;
    if (!month && normalizedMonth) {
      const numeric = Number(normalizedMonth);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
        month = String(numeric).padStart(2, '0');
      }
    }

    return this.sanitizePublishedAt(
      `${publishedYear}-${month ?? '01'}-01T00:00:00.000Z`,
      publishedYear,
    );
  }

  private async loadCatalogPublications(
    author: AuthorRecord,
    filterOptions?: { publishedFrom?: Date; publishedTo?: Date },
    authorIds?: Types.ObjectId[],
  ) {
    const relatedAuthorIds =
      authorIds && authorIds.length > 0 ? authorIds : [author._id];
    const filter: Record<string, unknown> = {
      authorIds:
        relatedAuthorIds.length === 1
          ? relatedAuthorIds[0]
          : { $in: relatedAuthorIds },
    };

    if (filterOptions?.publishedFrom || filterOptions?.publishedTo) {
      const dateRangeFilter: Record<string, Date> = {};
      if (filterOptions.publishedFrom) {
        dateRangeFilter.$gte = filterOptions.publishedFrom;
      }
      if (filterOptions.publishedTo) {
        dateRangeFilter.$lte = filterOptions.publishedTo;
      }

      const yearRangeFilter: Record<string, number> = {};
      if (filterOptions.publishedFrom) {
        yearRangeFilter.$gte = filterOptions.publishedFrom.getUTCFullYear();
      }
      if (filterOptions.publishedTo) {
        yearRangeFilter.$lte = filterOptions.publishedTo.getUTCFullYear();
      }

      filter.$or = [{ publishedAt: dateRangeFilter }, { publishedYear: yearRangeFilter }];
    }

    const list = await this.publicationModel
      .find(filter)
      .sort({ publishedAt: -1, publishedYear: -1, updatedAt: -1 })
      .lean()
      .exec();

    return list.map((item) =>
      this.formatPublicationOutput(
        item as unknown as PlainObject,
        author.sourceProfiles,
      ),
    );
  }

  private filterPublicationsByYearWindow(
    publications: Array<PlainObject | PublicationDocument>,
    window?: 1 | 3 | 5,
  ) {
    if (!window) {
      return publications;
    }

    const currentYear = new Date().getUTCFullYear();
    const minYear = currentYear - window;

    return publications.filter((publication) => {
      const publishedAt = publication.publishedAt;
      if (publishedAt instanceof Date && !Number.isNaN(publishedAt.getTime())) {
        return publishedAt.getUTCFullYear() >= minYear;
      }

      if (typeof publishedAt === 'string') {
        const parsedDate = new Date(publishedAt);
        if (!Number.isNaN(parsedDate.getTime())) {
          return parsedDate.getUTCFullYear() >= minYear;
        }
      }

      const publishedYear = this.readNumber(publication as PlainObject, [
        'publishedYear',
      ]);
      return typeof publishedYear === 'number' && publishedYear >= minYear;
    });
  }

  private formatSourceProfiles(sourceProfiles?: AuthorSourceProfile[]) {
    if (!Array.isArray(sourceProfiles) || sourceProfiles.length === 0) {
      return '-';
    }

    return sourceProfiles
      .map((profile) => `${profile.platform}:${profile.externalAuthorId}`)
      .join(', ');
  }

  private async loadAuthorIdentityCluster(author: AuthorRecord) {
    const normalizedName =
      author.normalizedName?.trim() || normalizePersonName(author.fullName);
    const nameTokens = normalizedName.split(' ').filter(Boolean);
    const surname = nameTokens[nameTokens.length - 1];

    if (!surname || nameTokens.length < 2) {
      return {
        relatedAuthors: [] as AuthorRecord[],
        authorIds: [author._id],
      };
    }

    const surnameRegex = new RegExp(this.escapeRegex(surname), 'i');
    const candidates = (await this.authorModel
      .find({
        _id: { $ne: author._id },
        $or: [
          { fullName: surnameRegex },
          { normalizedName: surnameRegex },
          { aliases: surnameRegex },
        ],
      })
      .limit(40)
      .lean()
      .exec()) as AuthorRecord[];

    const relatedAuthors = candidates.filter((candidate) =>
      this.isRelatedAuthorIdentity(author, candidate),
    );

    return {
      relatedAuthors,
      authorIds: this.mergeObjectIds(
        [author._id],
        relatedAuthors.map((item) => item._id),
      ),
    };
  }

  private buildClusteredAuthorRecord(
    author: AuthorRecord,
    cluster: { relatedAuthors: AuthorRecord[]; authorIds: Types.ObjectId[] },
  ): AuthorRecord {
    const mergedProfiles: AuthorSourceProfile[] = [];
    const mergedAliases = new Set<string>((author.aliases ?? []).filter(Boolean));
    const mergedAffiliations = new Set<string>(
      (author.affiliations ?? []).filter(Boolean),
    );
    const mergedInstitutionAliases = new Set<string>(
      (author.institutionAliases ?? []).filter(Boolean),
    );
    const mergedParsedAffiliations = new Map<string, PlainObject>();

    for (const item of [author, ...cluster.relatedAuthors]) {
      for (const alias of [item.fullName, ...(item.aliases ?? [])]) {
        if (alias?.trim()) {
          mergedAliases.add(alias.trim());
        }
      }

      for (const profile of item.sourceProfiles ?? []) {
        const exists = mergedProfiles.some(
          (current) =>
            current.platform === profile.platform &&
            current.externalAuthorId === profile.externalAuthorId,
        );
        if (!exists) {
          mergedProfiles.push({ ...profile });
        }
      }

      for (const affiliation of item.affiliations ?? []) {
        if (affiliation?.trim()) {
          mergedAffiliations.add(affiliation.trim());
        }
      }

      for (const alias of item.institutionAliases ?? []) {
        if (alias?.trim()) {
          mergedInstitutionAliases.add(alias.trim());
        }
      }

      for (const parsedAffiliation of item.parsedAffiliations ?? []) {
        const key = JSON.stringify(parsedAffiliation);
        if (!mergedParsedAffiliations.has(key)) {
          mergedParsedAffiliations.set(key, { ...parsedAffiliation });
        }
      }
    }

    return {
      ...author,
      aliases: Array.from(mergedAliases),
      sourceProfiles: mergedProfiles,
      affiliations: Array.from(mergedAffiliations),
      institutionAliases: Array.from(mergedInstitutionAliases),
      parsedAffiliations: Array.from(mergedParsedAffiliations.values()),
    };
  }

  private isRelatedAuthorIdentity(left: AuthorRecord, right: AuthorRecord) {
    const exactNormalizedMatch =
      this.getAuthorNameVariants(left).some((name) =>
        this.getAuthorNameVariants(right).some(
          (candidate) => normalizePersonName(name) === normalizePersonName(candidate),
        ),
      ) ||
      (left.normalizedName?.trim() &&
        right.normalizedName?.trim() &&
        left.normalizedName.trim() === right.normalizedName.trim());
    const compatibleNameMatch = this.getAuthorNameVariants(left).some((name) =>
      this.getAuthorNameVariants(right).some((candidate) =>
        arePersonNamesCompatible(name, candidate, {
          allowInitialSuffixMatch: true,
        }),
      ),
    );
    const institutionMatch = this.haveMatchingAuthorInstitution(left, right);
    const emailMatch = this.haveMatchingAuthorEmailDomain(left, right);
    const locationMatch = this.haveMatchingAuthorLocation(left, right);
    const sourceNoiseMatch =
      this.hasSourceNoiseInAuthorName(left.fullName) ||
      this.hasSourceNoiseInAuthorName(right.fullName);

    if (!exactNormalizedMatch && !compatibleNameMatch) {
      return false;
    }

    if (exactNormalizedMatch && (sourceNoiseMatch || emailMatch || institutionMatch || locationMatch)) {
      return true;
    }

    return compatibleNameMatch && (emailMatch || institutionMatch || locationMatch);
  }

  private getAuthorNameVariants(author: AuthorRecord) {
    return [...new Set([author.fullName, ...(author.aliases ?? [])].filter(Boolean))];
  }

  private haveMatchingAuthorInstitution(left: AuthorRecord, right: AuthorRecord) {
    if (
      left.institutionCanonicalKey?.trim() &&
      right.institutionCanonicalKey?.trim()
    ) {
      return left.institutionCanonicalKey.trim() === right.institutionCanonicalKey.trim();
    }

    if (!left.university?.trim() || !right.university?.trim()) {
      return false;
    }

    return (
      this.normalizeText(left.university) === this.normalizeText(right.university)
    );
  }

  private haveMatchingAuthorEmailDomain(left: AuthorRecord, right: AuthorRecord) {
    if (!left.emailDomain?.trim() || !right.emailDomain?.trim()) {
      return false;
    }

    return (
      left.emailDomain.trim().toLocaleLowerCase('tr-TR') ===
      right.emailDomain.trim().toLocaleLowerCase('tr-TR')
    );
  }

  private haveMatchingAuthorLocation(left: AuthorRecord, right: AuthorRecord) {
    if (
      !left.city?.trim() ||
      !left.country?.trim() ||
      !right.city?.trim() ||
      !right.country?.trim()
    ) {
      return false;
    }

    return (
      this.normalizeText(left.city) === this.normalizeText(right.city) &&
      this.normalizeText(left.country) === this.normalizeText(right.country)
    );
  }

  private hasSourceNoiseInAuthorName(value?: string) {
    return Boolean(
      value &&
        /\b(google scholar|google akademik|scholar|akademik|citations?)\b/i.test(
          value,
        ),
    );
  }

  private readAuthorNamesFromPublication(publication: PlainObject) {
    const candidateKeys = [
      'authors',
      'authorList',
      'writerList',
      'publicationAuthors',
      'contributors',
    ];

    const result: string[] = [];

    for (const key of candidateKeys) {
      const value = publication[key];
      if (!Array.isArray(value)) {
        continue;
      }

      for (const entry of value) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }

        const item = entry as PlainObject;
        const combinedName = [
          this.readString(item, ['firstName', 'givenName', 'name1']),
          this.readString(item, ['lastName', 'surname', 'familyName', 'name2']),
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

        const displayName =
          this.readString(item, [
            'name',
            'inPublicationName',
            'fullName',
            'authorName',
          ]) || combinedName;

        if (displayName) {
          result.push(displayName);
        }
      }
    }

    return this.mergeAuthorArrays([], result);
  }

  private splitAuthorText(value?: string | null) {
    if (!value?.trim()) {
      return [] as string[];
    }

    const normalized = value
      .replace(/\s+/g, ' ')
      .replace(/\s+and\s+/gi, ', ')
      .trim();

    return this.mergeAuthorArrays(
      [],
      normalized
        .split(/\s*[,;]\s*/)
        .map((item) => this.normalizeAuthorDisplay(item))
        .filter(Boolean),
    );
  }

  private normalizeAuthorDisplay(value?: string | null) {
    if (!value?.trim()) {
      return '';
    }

    return value
      .replace(/\s+/g, ' ')
      .replace(/\s+\./g, '.')
      .replace(/\.(?=\s|$)/g, '')
      .trim();
  }

  private readFlexibleStringArray(obj: PlainObject, keys: string[]) {
    const values: string[] = [];

    for (const key of keys) {
      const raw = obj[key];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === 'string' && item.trim()) {
            values.push(item.trim());
            continue;
          }

          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const value = this.readString(item as PlainObject, [
              'name',
              'title',
              'keyword',
              'value',
            ]);
            if (value) {
              values.push(value);
            }
          }
        }
      }

      if (typeof raw === 'string' && raw.trim()) {
        values.push(
          ...raw
            .split(/\s*[,;|]\s*/)
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }
    }

    return this.mergeStringArrays([], values);
  }

  private buildPages(obj: PlainObject) {
    const direct = this.readString(obj, [
      'pages',
      'page',
      'pageRange',
      'pageNumber',
    ]);
    if (direct) {
      return direct;
    }

    const start =
      this.readString(obj, ['startPage', 'firstPage', 'pageStart']) ?? '';
    const end =
      this.readString(obj, ['endPage', 'lastPage', 'pageEnd']) ?? '';

    if (start && end) {
      return `${start}-${end}`;
    }
    return start || end || undefined;
  }

  private mergeStringArrays(current: string[], incoming: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of [...current, ...incoming]) {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      const key = this.normalizeText(trimmed);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(trimmed);
    }

    return result;
  }

  private mergeAuthorArrays(current: string[], incoming: string[]) {
    const result: string[] = [];
    const identityToIndex = new Map<string, number>();
    const fallbackToIndex = new Map<string, number>();

    for (const value of [...current, ...incoming]) {
      const trimmed = this.normalizeAuthorDisplay(value);
      if (!trimmed) {
        continue;
      }

      const identity = this.buildAuthorIdentity(trimmed);
      if (identity) {
        const existingIndex = identityToIndex.get(identity);
        if (existingIndex === undefined) {
          identityToIndex.set(identity, result.length);
          result.push(trimmed);
          continue;
        }

        result[existingIndex] = this.pickPreferredAuthorName(
          result[existingIndex],
          trimmed,
        );
        continue;
      }

      const fallbackKey = this.normalizeText(trimmed);
      if (!fallbackKey) {
        continue;
      }

      const existingIndex = fallbackToIndex.get(fallbackKey);
      if (existingIndex === undefined) {
        fallbackToIndex.set(fallbackKey, result.length);
        result.push(trimmed);
        continue;
      }

      result[existingIndex] = this.pickPreferredAuthorName(
        result[existingIndex],
        trimmed,
      );
    }

    return result;
  }

  private buildAuthorIdentity(value: string) {
    const normalized = value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,]/g, ' ');
    const tokens = normalized
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return '';
    }

    if (tokens.length === 1) {
      return this.normalizeText(tokens[0]);
    }

    const first = tokens[0] ?? '';
    const last = tokens[tokens.length - 1] ?? '';
    const firstIsInitials = this.isInitialToken(first);
    const lastIsInitials = this.isInitialToken(last);

    if (tokens.length === 2 && firstIsInitials && !lastIsInitials) {
      return `${this.normalizeText(last)}|${this.normalizeText(first)}`;
    }

    if (tokens.length === 2 && !firstIsInitials && lastIsInitials) {
      return `${this.normalizeText(first)}|${this.normalizeText(last)}`;
    }

    const surname = this.normalizeText(last);
    const initials = tokens
      .slice(0, -1)
      .map((token) => this.normalizeText(token)[0] ?? '')
      .join('');

    return [surname, initials].filter(Boolean).join('|');
  }

  private isInitialToken(value: string) {
    const compact = this.normalizeText(value).replace(/\s+/g, '');
    if (!compact) {
      return false;
    }
    if (compact.length === 1) {
      return true;
    }
    if (compact.length > 3) {
      return false;
    }

    return !/[aeiou]/.test(compact);
  }

  private pickPreferredAuthorName(current: string, incoming: string) {
    const currentScore = this.authorDisplayScore(current);
    const incomingScore = this.authorDisplayScore(incoming);

    if (incomingScore > currentScore) {
      return incoming;
    }
    if (incomingScore < currentScore) {
      return current;
    }

    return incoming.length > current.length ? incoming : current;
  }

  private authorDisplayScore(value: string) {
    const normalized = value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,]/g, ' ');
    const tokens = normalized
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return 0;
    }

    let score = value.length;
    const longTokens = tokens.filter((token) => this.normalizeText(token).length > 1);
    const initialTokens = tokens.filter((token) => this.isInitialToken(token));

    score += longTokens.length * 10;
    score -= initialTokens.length * 4;

    if (tokens.length >= 3) {
      score += 40;
    }

    if (
      tokens.length === 2 &&
      this.isInitialToken(tokens[0] ?? '') &&
      this.normalizeText(tokens[1] ?? '').length > 1
    ) {
      score += 8;
    }

    if (
      tokens.length === 2 &&
      this.normalizeText(tokens[0] ?? '').length > 1 &&
      this.isInitialToken(tokens[1] ?? '')
    ) {
      score -= 6;
    }

    return score;
  }

  private mergeObjectIds(current: Types.ObjectId[], incoming: Types.ObjectId[]) {
    const seen = new Set<string>();
    const result: Types.ObjectId[] = [];

    for (const value of [...current, ...incoming]) {
      const objectId =
        value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
      const key = objectId.toString();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(objectId);
    }

    return result;
  }

  private pickPreferredText(
    current?: string | null,
    incoming?: string | null,
  ): string | undefined {
    const currentValue = current?.trim() || '';
    const incomingValue = incoming?.trim() || '';

    if (!currentValue) {
      return incomingValue || undefined;
    }
    if (!incomingValue) {
      return currentValue;
    }

    return incomingValue.length > currentValue.length
      ? incomingValue
      : currentValue;
  }

  private pickPreferredDate(
    current?: string | null,
    incoming?: string | null,
  ): string | undefined {
    if (!current) {
      return incoming || undefined;
    }
    if (!incoming) {
      return current;
    }

    const currentScore = this.datePrecisionScore(current);
    const incomingScore = this.datePrecisionScore(incoming);

    if (incomingScore > currentScore) {
      return incoming;
    }
    return current;
  }

  private pickPreferredYear(
    current?: number | null,
    incoming?: number | null,
    currentDate?: string | null,
    incomingDate?: string | null,
  ) {
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current;
    }
    if (typeof incoming === 'number' && Number.isFinite(incoming)) {
      return incoming;
    }

    const fallbackDate = currentDate || incomingDate;
    if (!fallbackDate) {
      return undefined;
    }

    const parsed = Date.parse(fallbackDate);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return new Date(parsed).getUTCFullYear();
  }

  private pickPreferredNumber(current?: number | null, incoming?: number | null) {
    if (typeof current === 'number' && typeof incoming === 'number') {
      return Math.max(current, incoming);
    }
    if (typeof current === 'number') {
      return current;
    }
    if (typeof incoming === 'number') {
      return incoming;
    }
    return undefined;
  }

  private datePrecisionScore(value: string) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return 4;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return 3;
    }
    if (/^\d{4}-\d{2}$/.test(value)) {
      return 2;
    }
    if (/^\d{4}$/.test(value)) {
      return 1;
    }
    return 0;
  }

  private sortTimestamp(publication: HarvestedPublication) {
    if (publication.publishedAt) {
      const parsed = Date.parse(publication.publishedAt);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    if (publication.publishedYear) {
      return Date.UTC(publication.publishedYear, 0, 1);
    }

    return 0;
  }

  private readObject(obj: PlainObject, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as PlainObject;
      }
    }
    return null;
  }

  private readStringArray(obj: PlainObject, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (!Array.isArray(value)) {
        continue;
      }

      const normalized = value
        .map((item) =>
          typeof item === 'string' ? this.normalizeAuthorDisplay(item) : null,
        )
        .filter((item): item is string => !!item);

      if (normalized.length > 0) {
        return normalized;
      }
    }

    return [] as string[];
  }

  private readString(obj: PlainObject, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  }

  private readNumber(obj: PlainObject, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }

  private extractFirstMatch(value: string, regex: RegExp) {
    const match = value.match(regex);
    return match?.[1]?.trim() || null;
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeTrdizinTitleSpacing(value?: string | null) {
    const normalized = value
      ?.trim()
      .replace(/([a-zçğıöşüâîû])([A-ZÇĞİÖŞÜÂÎÛ])/g, '$1 $2')
      .replace(/([0-9])([A-ZÇĞİÖŞÜÂÎÛ][a-zçğıöşüâîû])/g, '$1 $2')
      .replace(/\s+/g, ' ');

    if (!normalized) {
      return null;
    }

    return this.splitTrdizinGluedFirstToken(normalized);
  }

  private splitTrdizinGluedFirstToken(value: string) {
    const [firstToken, ...restTokens] = value.split(' ');
    if (!firstToken || restTokens.length === 0) {
      return value;
    }

    const suffixMatch = firstToken.match(/^(.{4,})(of|for|and|with|from)$/i);
    if (suffixMatch) {
      const [, stem, suffix] = suffixMatch;
      return [stem, suffix.toLowerCase(), ...restTokens].join(' ');
    }

    const leadingArticleMatch = firstToken.match(/^(The)([a-zçğıöşüâîû].{3,})$/);
    if (leadingArticleMatch) {
      const [, article, nextWord] = leadingArticleMatch;
      return [article, nextWord, ...restTokens].join(' ');
    }

    return value;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getProviderSearchName(fullName: string) {
    const cleaned = fullName
      .replace(
        /^(?:dr|dr\.|prof|prof\.|doc|doc\.|doç|doç\.|assoc\.?\s*prof\.?|asst\.?\s*prof\.?|assist\.?\s*prof\.?|öğr\.?\s*gör\.?|arş\.?\s*gör\.?)\s+/i,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || fullName.trim();
  }

  private normalizeDoi(value?: string | null) {
    if (!value?.trim()) {
      return undefined;
    }

    const cleaned = value
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
      .replace(/^doi:\s*/i, '')
      .replace(/[.)\],;]+$/g, '')
      .trim()
      .toLowerCase();

    const match = cleaned.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
    return match?.[0]?.toLowerCase() || undefined;
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private async mapWithConcurrency<T, TResult>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<TResult>,
  ) {
    if (items.length === 0) {
      return [] as TResult[];
    }

    const results = new Array<TResult>(items.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  private buildFingerprint(
    normalizedTitle: string,
    publishedYear?: number,
    journal?: string,
  ) {
    const normalizedJournal = journal ? this.normalizeText(journal) : '';
    return [normalizedTitle, publishedYear ?? '', normalizedJournal]
      .join('|')
      .trim();
  }

  private buildTitleYearKey(normalizedTitle: string, publishedYear?: number) {
    if (!normalizedTitle || !publishedYear) {
      return undefined;
    }
    return `${normalizedTitle}|${publishedYear}`;
  }

  private normalizeIsoDate(value?: string | null) {
    if (!value?.trim()) {
      return undefined;
    }

    const trimmed = value.trim();
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return this.sanitizePublishedAt(new Date(parsed).toISOString());
    }

    if (/^\d{4}$/.test(trimmed)) {
      return this.sanitizePublishedAt(`${trimmed}-01-01T00:00:00.000Z`);
    }

    return undefined;
  }

  private sanitizePublishedAt(
    value?: string | null,
    publishedYear?: number,
  ) {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    const year = parsed.getUTCFullYear();
    const currentYear = new Date().getUTCFullYear() + 1;
    if (year < 1000 || year > currentYear) {
      return undefined;
    }

    if (
      publishedYear &&
      Number.isInteger(publishedYear) &&
      publishedYear > 0 &&
      year !== publishedYear
    ) {
      return undefined;
    }

    return parsed.toISOString();
  }

  private normalizePubmedCitationDate(value?: string | null) {
    if (!value?.trim()) {
      return undefined;
    }

    const trimmed = value.trim();
    const fullDateMatch = trimmed.match(/^(\d{4})\s+([A-Za-z]{3,9})\s+(\d{1,2})$/);
    if (fullDateMatch) {
      const month = PUBMED_MONTHS[fullDateMatch[2].toLowerCase()];
      if (month) {
        return `${fullDateMatch[1]}-${month}-${String(fullDateMatch[3]).padStart(2, '0')}T00:00:00.000Z`;
      }
    }

    const monthDateMatch = trimmed.match(/^(\d{4})\s+([A-Za-z]{3,9})$/);
    if (monthDateMatch) {
      const month = PUBMED_MONTHS[monthDateMatch[2].toLowerCase()];
      if (month) {
        return `${monthDateMatch[1]}-${month}-01T00:00:00.000Z`;
      }
    }

    if (/^\d{4}$/.test(trimmed)) {
      return `${trimmed}-01-01T00:00:00.000Z`;
    }

    return this.normalizeIsoDate(trimmed);
  }

  private extractYear(value?: string | null) {
    if (!value?.trim()) {
      return undefined;
    }

    const yearMatch = value.match(/\b(\d{4})\b/);
    if (!yearMatch?.[1]) {
      return undefined;
    }

    const year = Number(yearMatch[1]);
    return Number.isInteger(year) ? year : undefined;
  }

  private extractMatchedAuthorNames(author?: PlainObject | null) {
    if (!author) {
      return [] as string[];
    }

    const combinedName = [
      this.readString(author, ['firstName', 'givenName', 'name1']),
      this.readString(author, ['lastName', 'surname', 'familyName', 'name2']),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const candidates = [
      this.readString(author, [
        'name',
        'inPublicationName',
        'fullName',
        'authorName',
      ]),
      combinedName || null,
    ].filter((value): value is string => Boolean(value?.trim()));

    return this.mergeStringArrays([], candidates);
  }

  private collectPubmedAuthorCandidates(
    publication: PlainObject,
    normalized: HarvestedPublication,
  ) {
    const detail = this.readObject(publication, ['detail']);
    const detailAuthors = detail
      ? this.readStringArray(detail, ['fullAuthors'])
      : [];
    const rawAuthors = this.splitAuthorText(
      this.readString(publication, ['authors']) ?? undefined,
    );

    return this.mergeStringArrays([], [
      ...detailAuthors,
      ...normalized.authors,
      ...rawAuthors,
    ]);
  }

  private matchesCatalogAuthor(
    author: AuthorRecord,
    candidateNames: string[],
  ) {
    const authorNames = this.mergeStringArrays([], [
      author.fullName,
      ...(author.aliases ?? []),
    ]);

    return authorNames.some((authorName) =>
      candidateNames.some((candidateName) =>
        arePersonNamesCompatible(authorName, candidateName, {
          allowInitialSuffixMatch: true,
        }),
      ),
    );
  }

  private isPlainObject(value: unknown): value is PlainObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private clonePlainObject(value?: PlainObject) {
    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(JSON.stringify(value)) as PlainObject;
    } catch {
      return { ...value };
    }
  }

  private isMeaningfulValue(value: unknown) {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (this.isPlainObject(value)) {
      return Object.keys(value).length > 0;
    }
    return true;
  }
}
