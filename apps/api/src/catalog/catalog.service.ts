import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstitutionNameInput,
  areInstitutionNamesEquivalent,
  extractInstitutionNameCandidate,
  isLikelyInstitutionName,
  pickPreferredInstitutionName,
  resolveInstitutionIdentity,
} from '../common/institution-normalization';
import { arePersonNamesCompatible } from '../common/person-name-match';
import { normalizePersonName } from '../common/normalize-person-name';
import { Author, AuthorDocument } from './schemas/author.schema';
import {
  Institution,
  InstitutionDocument,
} from './schemas/institution.schema';
import {
  Publication,
  PublicationDocument,
} from './schemas/publication.schema';

type CreateAuthorInput = {
  fullName: string;
  aliases?: string[];
  affiliations?: string[];
  orcid?: string;
};

type CreatePublicationInput = {
  title: string;
  doi?: string;
  journal?: string;
  publishedAt?: string;
  publishedYear?: number;
  authors?: string[];
  citationCount?: number;
  authorIds?: string[];
  sourceRecords?: Array<{
    platform: string;
    sourceId?: string;
    sourceUrl?: string;
  }>;
};

type ListPublicationsInput = {
  authorId?: string;
  query?: string;
  publishedFrom?: Date;
  publishedTo?: Date;
  publishedWithinYears?: 1 | 3 | 5;
};

type SearchAuthorsDbOnlyFilters = {
  country?: string;
  city?: string;
  institution?: string;
};

type AuthorSearchSignature = {
  normalizedQuery: string;
  tokens: string[];
  surname?: string;
  givenTokens: string[];
  compactInitials?: string;
};

type DiscoveredAuthorInput = {
  displayName: string;
  normalizedName: string;
  affiliationRaw?: string[];
  parsedAffiliations?: Array<Record<string, unknown>>;
  searchKeywords?: string[];
  institutionAliases?: string[];
  university?: string;
  city?: string;
  country?: string;
  emailDomain?: string;
  sourceProfiles: Array<{
    platform: string;
    externalAuthorId: string;
    profileUrl?: string;
    score?: number;
  }>;
};

type UpsertInstitutionAliasInput = {
  canonicalName: string;
  aliases?: string[];
  canonicalLocked?: boolean;
  city?: string;
  country?: string;
};

export type AdminSourceProfileInput = {
  platform?: string;
  platformKey?: string;
  externalAuthorId?: string;
  profileUrl?: string;
  score?: number;
  lastSyncedAt?: string;
};

export type AdminAuthorUpdateInput = {
  fullName?: string;
  aliases?: string[];
  affiliations?: string[];
  parsedAffiliations?: Array<Record<string, unknown>>;
  searchKeywords?: string[];
  institutionAliases?: string[];
  university?: string | null;
  city?: string | null;
  country?: string | null;
  emailDomain?: string | null;
  orcid?: string | null;
  sourceProfiles?: AdminSourceProfileInput[];
};

export type AdminMergeAuthorsInput = {
  primaryAuthorId: string;
  secondaryAuthorId: string;
};

export type AdminDetachSourceProfilesInput = {
  sourceProfiles: AdminSourceProfileInput[];
  targetAuthorId?: string;
  newAuthor?: AdminAuthorUpdateInput;
  publicationIds?: string[];
  removeSelectedPublicationsFromSource?: boolean;
};

export type AdminRemoveSourceProfilesInput = {
  sourceProfiles: AdminSourceProfileInput[];
  publicationIds?: string[];
};

export type AdminReassignPublicationsInput = {
  fromAuthorId: string;
  toAuthorId: string;
  publicationIds: string[];
  removeFromSource?: boolean;
};

const GENERIC_AUTHOR_FILTER_TOKENS = new Set([
  'university',
  'universite',
  'universitesi',
  'universitesi',
  'faculty',
  'fakultesi',
  'department',
  'dept',
  'bolumu',
  'bolum',
  'of',
  'the',
  've',
  'and',
]);

const FILTER_COUNTRY_ALIASES: Record<string, string[]> = {
  turkiye: ['turkiye', 'turkey', 'tr'],
  usa: ['usa', 'us', 'united states', 'united states of america', 'abd'],
  germany: ['germany', 'almanya', 'deutschland'],
  france: ['france', 'fransa'],
  uk: ['uk', 'united kingdom', 'ingiltere', 'england'],
};

const SINGLE_AUTHOR_PROFILE_PLATFORMS = new Set([
  'trdizin',
  'serpapi_scholar',
  'clarivate_wos',
  'scraper_scopus',
  'scopus_scraper',
]);

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectModel(Author.name) private readonly authorModel: Model<AuthorDocument>,
    @InjectModel(Institution.name)
    private readonly institutionModel: Model<InstitutionDocument>,
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<PublicationDocument>,
  ) {}

  async createAuthor(input: CreateAuthorInput) {
    this.logger.log(`createAuthor started for fullName="${input.fullName}"`);
    const normalizedName = this.normalizeAuthorName(input.fullName);
    const aliases =
      input.aliases?.map((alias) => alias.trim()).filter(Boolean) ?? [];

    const created = await this.authorModel.create({
      fullName: input.fullName.trim(),
      normalizedName,
      aliases: [...new Set(aliases)],
      affiliations: input.affiliations ?? [],
      orcid: input.orcid?.trim() || undefined,
      sourceProfiles: [],
    });

    this.logger.log(`createAuthor completed with id=${created._id.toString()}`);
    return this.formatAuthorOutput(created.toObject());
  }

  async getAuthorById(id: string) {
    const author = await this.authorModel.findById(id).lean().exec();
    if (!author) {
      throw new NotFoundException('Yazar bulunamadi.');
    }
    return this.formatAuthorOutput(author);
  }

  async getAuthorByPlatformId(platform: string, externalAuthorId: string) {
    const author = await this.authorModel
      .findOne({
        sourceProfiles: {
          $elemMatch: {
            platform,
            externalAuthorId,
          },
        },
      })
      .lean()
      .exec();

    if (!author) {
      throw new NotFoundException('Platform id ile yazar bulunamadi.');
    }

    return this.formatAuthorOutput(author);
  }

  async adminSearchAuthors(query: string, limit = 20) {
    return this.searchAuthorsDbOnly(query, limit);
  }

  async adminUpdateAuthor(id: string, input: AdminAuthorUpdateInput) {
    const authorDoc = await this.loadAuthorDocumentOrThrow(id, 'Yazar');
    await this.applyAdminAuthorUpdate(authorDoc, input);
    const saved = await authorDoc.save();
    return this.formatAuthorOutput(saved);
  }

  async adminMergeAuthors(input: AdminMergeAuthorsInput) {
    const primaryId = input.primaryAuthorId?.trim();
    const secondaryId = input.secondaryAuthorId?.trim();

    if (!primaryId || !secondaryId) {
      throw new BadRequestException(
        '`primaryAuthorId` ve `secondaryAuthorId` zorunlu.',
      );
    }

    if (primaryId === secondaryId) {
      throw new BadRequestException('Ayni yazar kendisiyle merge edilemez.');
    }

    const [primaryAuthor, secondaryAuthor] = await Promise.all([
      this.loadAuthorDocumentOrThrow(primaryId, 'Birincil yazar'),
      this.loadAuthorDocumentOrThrow(secondaryId, 'Ikinci yazar'),
    ]);

    const preferredName = this.pickPreferredAuthorName(
      {
        displayName: primaryAuthor.fullName,
        normalizedName:
          primaryAuthor.normalizedName ||
          this.normalizeAuthorName(primaryAuthor.fullName),
      },
      {
        displayName: secondaryAuthor.fullName,
        normalizedName:
          secondaryAuthor.normalizedName ||
          this.normalizeAuthorName(secondaryAuthor.fullName),
      },
    );

    await this.applyAdminAuthorUpdate(primaryAuthor, {
      fullName: preferredName.displayName,
      aliases: this.mergeUniqueStrings([
        ...(primaryAuthor.aliases ?? []),
        ...(secondaryAuthor.aliases ?? []),
        primaryAuthor.fullName,
        secondaryAuthor.fullName,
      ]).filter((alias) => alias !== preferredName.displayName),
      affiliations: this.mergeUniqueStrings([
        ...(primaryAuthor.affiliations ?? []),
        ...(secondaryAuthor.affiliations ?? []),
      ]),
      parsedAffiliations: this.mergeParsedAffiliations(
        primaryAuthor.parsedAffiliations ?? [],
        secondaryAuthor.parsedAffiliations ?? [],
      ),
      searchKeywords: this.mergeUniqueStrings([
        ...(primaryAuthor.searchKeywords ?? []),
        ...(secondaryAuthor.searchKeywords ?? []),
      ]),
      institutionAliases: this.mergeUniqueStrings([
        ...(primaryAuthor.institutionAliases ?? []),
        ...(secondaryAuthor.institutionAliases ?? []),
      ]),
      university: primaryAuthor.university?.trim() || secondaryAuthor.university?.trim() || null,
      city: primaryAuthor.city?.trim() || secondaryAuthor.city?.trim() || null,
      country: primaryAuthor.country?.trim() || secondaryAuthor.country?.trim() || null,
      emailDomain:
        primaryAuthor.emailDomain?.trim() ||
        secondaryAuthor.emailDomain?.trim() ||
        null,
      orcid: primaryAuthor.orcid?.trim() || secondaryAuthor.orcid?.trim() || null,
      sourceProfiles: this.mergeSourceProfilesForAdmin(
        primaryAuthor.sourceProfiles ?? [],
        secondaryAuthor.sourceProfiles ?? [],
      ),
    });

    const savedPrimary = await primaryAuthor.save();
    const publicationTransfer = await this.reassignPublicationOwnership({
      fromAuthorId: secondaryId,
      toAuthorId: primaryId,
      removeFromSource: true,
    });

    await this.authorModel.findByIdAndDelete(secondaryAuthor._id).exec();

    return {
      primaryAuthorId: savedPrimary._id.toString(),
      mergedFromAuthorId: secondaryAuthor._id.toString(),
      movedPublicationCount: publicationTransfer.updatedCount,
      movedPublicationIds: publicationTransfer.publicationIds,
      author: this.formatAuthorOutput(savedPrimary),
    };
  }

  async adminDetachSourceProfiles(
    authorId: string,
    input: AdminDetachSourceProfilesInput,
  ) {
    const sourceAuthor = await this.loadAuthorDocumentOrThrow(authorId, 'Kaynak yazar');
    const requestedProfiles = this.sanitizeAdminSourceProfiles(input.sourceProfiles);

    if (requestedProfiles.length === 0) {
      throw new BadRequestException('Ayrilacak en az bir source profile secilmeli.');
    }

    if (input.targetAuthorId?.trim() && input.newAuthor) {
      throw new BadRequestException(
        '`targetAuthorId` ile `newAuthor` ayni anda kullanilamaz.',
      );
    }

    const sourceProfiles = sourceAuthor.sourceProfiles ?? [];
    const detachedProfiles = sourceProfiles.filter((profile) =>
      requestedProfiles.some(
        (candidate) =>
          profile.platform === candidate.platform &&
          profile.externalAuthorId === candidate.externalAuthorId,
      ),
    );

    if (detachedProfiles.length === 0) {
      throw new BadRequestException(
        'Secilen source profile kayitlari yazarda bulunamadi.',
      );
    }

    sourceAuthor.sourceProfiles = sourceProfiles.filter(
      (profile) =>
        !detachedProfiles.some(
          (candidate) =>
            candidate.platform === profile.platform &&
            candidate.externalAuthorId === profile.externalAuthorId,
        ),
    );

    let targetAuthor: AuthorDocument;
    let createdAuthor = false;

    if (input.targetAuthorId?.trim()) {
      if (input.targetAuthorId.trim() === authorId.trim()) {
        throw new BadRequestException(
          'Source profile ayrimi icin hedef yazar farkli olmali.',
        );
      }
      targetAuthor = await this.loadAuthorDocumentOrThrow(
        input.targetAuthorId.trim(),
        'Hedef yazar',
      );
      targetAuthor.sourceProfiles = this.mergeSourceProfilesForAdmin(
        targetAuthor.sourceProfiles ?? [],
        detachedProfiles,
      ) as typeof targetAuthor.sourceProfiles;
      await this.applyAdminAuthorUpdate(targetAuthor, {
        sourceProfiles: this.mergeSourceProfilesForAdmin(
          targetAuthor.sourceProfiles ?? [],
        ),
      });
    } else {
      createdAuthor = true;
      const seedInput: AdminAuthorUpdateInput = {
        fullName: sourceAuthor.fullName,
        aliases: [...(sourceAuthor.aliases ?? [])],
        affiliations: [...(sourceAuthor.affiliations ?? [])],
        parsedAffiliations: this.clonePlainRecords(sourceAuthor.parsedAffiliations ?? []),
        searchKeywords: [...(sourceAuthor.searchKeywords ?? [])],
        institutionAliases: [...(sourceAuthor.institutionAliases ?? [])],
        university: sourceAuthor.university ?? null,
        city: sourceAuthor.city ?? null,
        country: sourceAuthor.country ?? null,
        emailDomain: sourceAuthor.emailDomain ?? null,
        orcid: sourceAuthor.orcid ?? null,
        sourceProfiles: this.mergeSourceProfilesForAdmin(detachedProfiles),
        ...input.newAuthor,
      };

      const initialName = seedInput.fullName?.trim() || sourceAuthor.fullName;
      targetAuthor = new this.authorModel({
        fullName: initialName,
        normalizedName: this.normalizeAuthorName(initialName),
        aliases: [],
        affiliations: [],
        parsedAffiliations: [],
        searchKeywords: [],
        institutionAliases: [],
        sourceProfiles: [],
      });
      await this.applyAdminAuthorUpdate(targetAuthor, seedInput);
    }

    await Promise.all([sourceAuthor.save(), targetAuthor.save()]);

    let publicationTransfer = {
      updatedCount: 0,
      publicationIds: [] as string[],
    };
    if ((input.publicationIds ?? []).length > 0) {
      publicationTransfer = await this.reassignPublicationOwnership({
        fromAuthorId: sourceAuthor._id.toString(),
        toAuthorId: targetAuthor._id.toString(),
        publicationIds: input.publicationIds,
        removeFromSource: input.removeSelectedPublicationsFromSource !== false,
      });
    }

    return {
      sourceAuthor: this.formatAuthorOutput(sourceAuthor),
      targetAuthor: this.formatAuthorOutput(targetAuthor),
      createdAuthor,
      detachedSourceProfiles: detachedProfiles.map((profile) =>
        this.formatSourceProfileOutput(
          this.toPlainObject(profile) as Record<string, unknown>,
        ),
      ),
      movedPublicationCount: publicationTransfer.updatedCount,
      movedPublicationIds: publicationTransfer.publicationIds,
    };
  }

  async adminRemoveSourceProfiles(
    authorId: string,
    input: AdminRemoveSourceProfilesInput,
  ) {
    const sourceAuthor = await this.loadAuthorDocumentOrThrow(authorId, 'Yazar');
    const requestedProfiles = this.sanitizeAdminSourceProfiles(input.sourceProfiles);

    if (requestedProfiles.length === 0) {
      throw new BadRequestException('Silinecek en az bir source profile secilmeli.');
    }

    const sourceProfiles = sourceAuthor.sourceProfiles ?? [];
    const removedProfiles = sourceProfiles.filter((profile) =>
      requestedProfiles.some(
        (candidate) =>
          profile.platform === candidate.platform &&
          profile.externalAuthorId === candidate.externalAuthorId,
      ),
    );

    if (removedProfiles.length === 0) {
      throw new BadRequestException(
        'Secilen source profile kayitlari yazarda bulunamadi.',
      );
    }

    sourceAuthor.sourceProfiles = sourceProfiles.filter(
      (profile) =>
        !removedProfiles.some(
          (candidate) =>
            candidate.platform === profile.platform &&
            candidate.externalAuthorId === profile.externalAuthorId,
        ),
    );

    await sourceAuthor.save();

    let publicationRemoval = {
      updatedCount: 0,
      publicationIds: [] as string[],
    };
    if ((input.publicationIds ?? []).length > 0) {
      publicationRemoval = await this.unlinkPublicationOwnership({
        authorId: sourceAuthor._id.toString(),
        publicationIds: input.publicationIds,
      });
    }

    return {
      sourceAuthor: this.formatAuthorOutput(sourceAuthor),
      removedSourceProfiles: removedProfiles.map((profile) =>
        this.formatSourceProfileOutput(
          this.toPlainObject(profile) as Record<string, unknown>,
        ),
      ),
      updatedPublicationCount: publicationRemoval.updatedCount,
      updatedPublicationIds: publicationRemoval.publicationIds,
    };
  }

  async adminReassignPublications(input: AdminReassignPublicationsInput) {
    const fromAuthorId = input.fromAuthorId?.trim();
    const toAuthorId = input.toAuthorId?.trim();

    if (!fromAuthorId || !toAuthorId) {
      throw new BadRequestException('`fromAuthorId` ve `toAuthorId` zorunlu.');
    }

    if (fromAuthorId === toAuthorId) {
      throw new BadRequestException('Yayin tasima icin kaynak ve hedef farkli olmali.');
    }

    const [fromAuthor, toAuthor, transfer] = await Promise.all([
      this.loadAuthorDocumentOrThrow(fromAuthorId, 'Kaynak yazar'),
      this.loadAuthorDocumentOrThrow(toAuthorId, 'Hedef yazar'),
      this.reassignPublicationOwnership({
        fromAuthorId,
        toAuthorId,
        publicationIds: input.publicationIds,
        removeFromSource: input.removeFromSource !== false,
      }),
    ]);

    return {
      fromAuthor: this.formatAuthorOutput(fromAuthor),
      toAuthor: this.formatAuthorOutput(toAuthor),
      movedPublicationCount: transfer.updatedCount,
      movedPublicationIds: transfer.publicationIds,
    };
  }

  async searchAuthorsDbOnly(
    query: string,
    limit = 20,
    filters: SearchAuthorsDbOnlyFilters = {},
  ) {
    if (!query?.trim()) {
      return [];
    }

    const dbResults = await this.searchAuthorsInDb(
      query,
      Math.min(Math.max(limit, 1), 200),
      filters,
    );
    return dbResults
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((item) => this.formatAuthorOutput(item));
  }

  async listAuthorFilterSeeds() {
    this.logger.log('listAuthorFilterSeeds started');

    const list = await this.authorModel
      .find(
        {},
        {
          institutionId: 1,
          institutionCanonicalKey: 1,
          institutionAliases: 1,
          university: 1,
          city: 1,
          country: 1,
          affiliations: 1,
          parsedAffiliations: 1,
        },
      )
      .lean()
      .exec();

    this.logger.log(`listAuthorFilterSeeds completed count=${list.length}`);
    return list.map((item) => this.formatAuthorOutput(item));
  }

  async listInstitutionFilterSeeds() {
    this.logger.log('listInstitutionFilterSeeds started');

    const [list, authorCounts] = await Promise.all([
      this.institutionModel
        .find(
          {},
          {
            canonicalName: 1,
            normalizedKey: 1,
            aliases: 1,
            manualAliases: 1,
            platformAliases: 1,
            city: 1,
            country: 1,
          },
        )
        .sort({ canonicalName: 1, updatedAt: -1 })
        .lean()
        .exec(),
      this.authorModel
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              institutionCanonicalKey: { $exists: true, $nin: [null, ''] },
            },
          },
          {
            $group: {
              _id: '$institutionCanonicalKey',
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
    ]);

    const authorCountMap = new Map<string, number>();
    for (const item of authorCounts) {
      if (!item?._id || !item.count) {
        continue;
      }
      authorCountMap.set(item._id, item.count);
    }

    const grouped = new Map<
      string,
      Record<string, unknown> & {
        canonicalName: string;
        aliases: string[];
        authorCount: number;
        city?: string;
        country?: string;
      }
    >();

    for (const item of list) {
      const plain = this.toPlainObject(item);
      const resolved = this.resolveBestInstitutionIdentity(
        this.buildInstitutionInputsFromInstitutionPlain(plain),
        { minimumConfidence: 1 },
      );
      if (!resolved) {
        continue;
      }

      const key = resolved.normalizedKey;
      const authorCount =
        authorCountMap.get(
          this.readStringFromObject(plain, ['normalizedKey']) ?? '',
        ) ?? 0;

      const existing = grouped.get(key);
      if (!existing) {
        const formatted = this.formatInstitutionOutput({
          ...plain,
          canonicalName: resolved.canonicalName,
          normalizedKey: resolved.normalizedKey,
          aliases: resolved.aliases,
          city: resolved.city ?? this.readStringFromObject(plain, ['city']),
          country:
            resolved.country ?? this.readStringFromObject(plain, ['country']),
        }) as Record<string, unknown>;
        grouped.set(key, {
          ...formatted,
          canonicalName: resolved.canonicalName,
          aliases: [...resolved.aliases],
          authorCount,
          city: (formatted.city as string | undefined) ?? resolved.city,
          country:
            (formatted.country as string | undefined) ?? resolved.country,
        });
        continue;
      }

      existing.authorCount += authorCount;
      existing.canonicalName =
        pickPreferredInstitutionName(
          existing.canonicalName,
          resolved.canonicalName,
        ) ?? existing.canonicalName;
      existing.aliases = [
        ...new Set([...(existing.aliases ?? []), ...resolved.aliases]),
      ].filter((alias) => alias !== existing.canonicalName);
      existing.city = existing.city ?? resolved.city;
      existing.country = existing.country ?? resolved.country;
    }

    const seeds = Array.from(grouped.values()).sort((left, right) =>
      (left.canonicalName ?? '').localeCompare(
        right.canonicalName ?? '',
        'tr-TR',
        { sensitivity: 'base' },
      ),
    );

    this.logger.log(`listInstitutionFilterSeeds completed count=${seeds.length}`);
    return seeds;
  }

  async getCatalogStats() {
    this.logger.log('getCatalogStats started');
    const [totalPublications, totalAuthors, universities, countries] =
      await Promise.all([
        this.publicationModel.countDocuments({}).exec(),
        this.authorModel.countDocuments({}).exec(),
        this.authorModel.distinct('university', {
          university: { $exists: true, $nin: [null, ''] },
        }),
        this.authorModel.distinct('country', {
          country: { $exists: true, $nin: [null, ''] },
        }),
      ]);

    const stats = {
      totalPublications,
      totalAuthors,
      totalInstitutions: universities.length,
      totalCountries: countries.length,
      fetchedAt: new Date().toISOString(),
    };

    this.logger.log(
      `getCatalogStats completed publications=${stats.totalPublications} authors=${stats.totalAuthors} institutions=${stats.totalInstitutions} countries=${stats.totalCountries}`,
    );
    return stats;
  }

  async listInstitutions(query?: string) {
    const trimmed = query?.trim();
    this.logger.log(`listInstitutions started query="${trimmed ?? ''}"`);
    const items = await this.listInstitutionFilterSeeds();
    const regex = trimmed
      ? new RegExp(this.escapeRegex(trimmed), 'i')
      : null;
    const filtered = regex
      ? items.filter((item) =>
          [
            item.canonicalName,
            ...(Array.isArray(item.aliases) ? item.aliases : []),
            ...(Array.isArray(item.manualAliases) ? item.manualAliases : []),
          ].some(
            (value) => typeof value === 'string' && regex.test(value),
          ),
        )
      : items;

    const result = filtered.slice(0, 100);
    this.logger.log(`listInstitutions completed count=${result.length}`);
    return result;
  }

  async upsertInstitutionAliasOverride(input: UpsertInstitutionAliasInput) {
    this.logger.log(
      `upsertInstitutionAliasOverride started canonicalName="${input.canonicalName}"`,
    );
    const canonicalName = input.canonicalName.trim();
    const aliases = [
      ...new Set(
        (input.aliases ?? [])
          .map((alias) => alias.trim())
          .filter((alias) => !!alias && alias !== canonicalName),
      ),
    ];

    const institution = await this.upsertInstitutionRecord(
      [
        {
          name: canonicalName,
          city: input.city,
          country: input.country,
        },
        ...aliases.map((alias) => ({
          name: alias,
          city: input.city,
          country: input.country,
        })),
      ],
      {
        preferredCanonicalName: canonicalName,
        manualAliases: aliases,
        canonicalLocked: input.canonicalLocked ?? true,
        city: input.city,
        country: input.country,
      },
    );

    if (!institution) {
      throw new NotFoundException('Kurum override kaydi olusturulamadi.');
    }

    this.logger.log(
      `upsertInstitutionAliasOverride completed institutionId=${institution._id.toString()}`,
    );
    return this.formatInstitutionOutput(institution);
  }

  async backfillInstitutions(options: { limit?: number; dryRun?: boolean } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 10000);
    const dryRun = options.dryRun === true;
    this.logger.log(
      `backfillInstitutions started limit=${limit} dryRun=${dryRun}`,
    );

    const institutionCountBefore = await this.institutionModel.countDocuments({}).exec();
    const authors = await this.authorModel.find().limit(limit).exec();

    let authorsWithInstitutionData = 0;
    let linkedAuthors = 0;
    let updatedAuthors = 0;

    for (const authorDoc of authors) {
      const institutionInputs = this.buildInstitutionInputsFromAuthor(authorDoc);
      if (institutionInputs.length === 0) {
        continue;
      }

      authorsWithInstitutionData += 1;
      if (dryRun) {
        const preview = this.resolveBestInstitutionIdentity(institutionInputs, {
          minimumConfidence: 6,
        });
        if (preview) {
          linkedAuthors += 1;
        }
        continue;
      }

      const institution = await this.upsertInstitutionRecord(institutionInputs, {
        minimumConfidence: 6,
      });
      if (!institution) {
        continue;
      }

      linkedAuthors += 1;

      const nextInstitutionAliases = [...institution.aliases];
      const nextUniversity = institution.canonicalName;
      const nextCity = institution.city ?? authorDoc.city;
      const nextCountry = institution.country ?? authorDoc.country;
      const nextParsedAffiliations = (authorDoc.parsedAffiliations ?? []).map((item) =>
        this.attachInstitutionMetadata(item, institution),
      );
      const nextSearchKeywords = [...(authorDoc.searchKeywords ?? [])];
      for (const keyword of this.extractInstitutionKeywords(institution)) {
        if (!nextSearchKeywords.includes(keyword)) {
          nextSearchKeywords.push(keyword);
        }
      }

      const changed =
        this.readStringFromObject(this.toPlainObject(authorDoc), ['institutionId']) !==
          institution._id.toString() ||
        authorDoc.institutionCanonicalKey !== institution.normalizedKey ||
        authorDoc.university !== nextUniversity ||
        authorDoc.city !== nextCity ||
        authorDoc.country !== nextCountry ||
        JSON.stringify(authorDoc.institutionAliases ?? []) !==
          JSON.stringify(nextInstitutionAliases) ||
        JSON.stringify(authorDoc.parsedAffiliations ?? []) !==
          JSON.stringify(nextParsedAffiliations) ||
        JSON.stringify(authorDoc.searchKeywords ?? []) !==
          JSON.stringify(nextSearchKeywords);

      if (!changed) {
        continue;
      }

      authorDoc.institutionId = institution._id as Types.ObjectId;
      authorDoc.institutionCanonicalKey = institution.normalizedKey;
      authorDoc.institutionAliases = nextInstitutionAliases;
      authorDoc.university = nextUniversity;
      authorDoc.city = nextCity;
      authorDoc.country = nextCountry;
      authorDoc.parsedAffiliations = nextParsedAffiliations;
      authorDoc.searchKeywords = nextSearchKeywords;
      await authorDoc.save();
      updatedAuthors += 1;
    }

    const institutionCountAfter = dryRun
      ? institutionCountBefore
      : await this.institutionModel.countDocuments({}).exec();

    const result = {
      scannedAuthors: authors.length,
      authorsWithInstitutionData,
      linkedAuthors,
      updatedAuthors,
      institutionsBefore: institutionCountBefore,
      institutionsAfter: institutionCountAfter,
      createdInstitutions: Math.max(
        0,
        institutionCountAfter - institutionCountBefore,
      ),
      dryRun,
      fetchedAt: new Date().toISOString(),
    };

    this.logger.log(`backfillInstitutions completed ${JSON.stringify(result)}`);
    return result;
  }

  async resetInstitutions() {
    this.logger.log('resetInstitutions started');

    const deletedInstitutions = await this.institutionModel.countDocuments({}).exec();
    await this.institutionModel.deleteMany({}).exec();
    const authors = await this.authorModel.find().exec();

    for (const authorDoc of authors) {
      authorDoc.institutionId = undefined;
      authorDoc.institutionCanonicalKey = undefined;
      authorDoc.institutionAliases = [];
      authorDoc.university = undefined;

      authorDoc.parsedAffiliations = (authorDoc.parsedAffiliations ?? []).map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }

        const plain = { ...(item as Record<string, unknown>) };
        delete plain.university;
        delete plain.institutionId;
        delete plain.institutionCanonicalName;
        delete plain.institutionCanonicalKey;
        return plain;
      });

      await authorDoc.save();
    }

    const result = {
      deletedInstitutions,
      resetAuthors: authors.length,
      fetchedAt: new Date().toISOString(),
    };

    this.logger.log(`resetInstitutions completed ${JSON.stringify(result)}`);
    return result;
  }

  async upsertDiscoveredAuthor(input: DiscoveredAuthorInput) {
    this.logger.log(
      `upsertDiscoveredAuthor started displayName="${input.displayName}"`,
    );
    const incomingDisplayName = input.displayName.trim();
    const incomingNormalizedName =
      input.normalizedName || this.normalizeAuthorName(incomingDisplayName);

    let authorDoc: AuthorDocument | null = null;

    if (input.sourceProfiles.length > 0) {
      const sourceOr = input.sourceProfiles.map((profile) => ({
        sourceProfiles: {
          $elemMatch: {
            platform: profile.platform,
            externalAuthorId: profile.externalAuthorId,
          },
        },
      }));
      authorDoc = await this.authorModel.findOne({ $or: sourceOr }).exec();
    }

    if (!authorDoc) {
      authorDoc = await this.findBestExistingAuthorForDiscoveredInput(
        input,
        incomingDisplayName,
        incomingNormalizedName,
      );
    }

    if (
      authorDoc &&
      this.hasStablePlatformProfileConflictWithExisting(authorDoc, input)
    ) {
      authorDoc = null;
    }

    const isNew = !authorDoc;
    if (!authorDoc) {
      authorDoc = new this.authorModel({
        fullName: incomingDisplayName,
        normalizedName: incomingNormalizedName,
        aliases: [],
        affiliations: [],
        parsedAffiliations: [],
        searchKeywords: [],
        institutionAliases: [],
        sourceProfiles: [],
      });
    }

    const rawAffiliations = input.affiliationRaw ?? [];
    for (const raw of rawAffiliations) {
      if (raw && !authorDoc.affiliations.includes(raw)) {
        authorDoc.affiliations.push(raw);
      }
    }

    const parsed = input.parsedAffiliations ?? [];
    const existingParsedRaw = new Set(
      (authorDoc.parsedAffiliations ?? [])
        .map((item) => (item && typeof item === 'object' ? item.raw : null))
        .filter((item): item is string => typeof item === 'string' && !!item),
    );
    for (const item of parsed) {
      const raw = typeof item.raw === 'string' ? item.raw : null;
      if (raw && !existingParsedRaw.has(raw)) {
        authorDoc.parsedAffiliations.push(item);
        existingParsedRaw.add(raw);
      }
    }

    const incomingKeywords = input.searchKeywords ?? [];
    for (const keyword of incomingKeywords) {
      if (keyword && !authorDoc.searchKeywords.includes(keyword)) {
        authorDoc.searchKeywords.push(keyword);
      }
    }

    const institution = await this.upsertInstitutionRecord([
      ...this.buildInstitutionInputsFromAuthor(authorDoc),
      ...this.buildInstitutionInputsFromDiscoveredAuthor(input),
    ]);

    if (institution) {
      authorDoc.institutionId = institution._id as Types.ObjectId;
      authorDoc.institutionCanonicalKey = institution.normalizedKey;
      authorDoc.institutionAliases = [...institution.aliases];
      authorDoc.university = institution.canonicalName;
      authorDoc.city = institution.city ?? input.city ?? authorDoc.city;
      authorDoc.country = institution.country ?? input.country ?? authorDoc.country;
      authorDoc.parsedAffiliations = (authorDoc.parsedAffiliations ?? []).map((item) =>
        this.attachInstitutionMetadata(item, institution),
      );

      for (const keyword of this.extractInstitutionKeywords(institution)) {
        if (!authorDoc.searchKeywords.includes(keyword)) {
          authorDoc.searchKeywords.push(keyword);
        }
      }
    } else {
      authorDoc.university = authorDoc.university ?? input.university;
      authorDoc.city = authorDoc.city ?? input.city;
      authorDoc.country = authorDoc.country ?? input.country;
    }

    authorDoc.emailDomain = authorDoc.emailDomain ?? input.emailDomain;
    this.mergeCanonicalAuthorName(
      authorDoc,
      incomingDisplayName,
      incomingNormalizedName,
    );

    for (const sourceProfile of input.sourceProfiles) {
      const exists = authorDoc.sourceProfiles.some(
        (profile) =>
          profile.platform === sourceProfile.platform &&
          profile.externalAuthorId === sourceProfile.externalAuthorId,
      );

      if (!exists) {
        authorDoc.sourceProfiles.push({
          platform: sourceProfile.platform,
          externalAuthorId: sourceProfile.externalAuthorId,
          profileUrl: sourceProfile.profileUrl,
          score: sourceProfile.score,
          lastSyncedAt: new Date(),
        });
      }
    }

    const saved = await authorDoc.save();
    this.logger.log(
      `upsertDiscoveredAuthor completed id=${saved._id.toString()} status=${isNew ? 'inserted' : 'updated_or_existing'}`,
    );

    return {
      authorId: saved._id.toString(),
      status: isNew ? 'inserted' : 'updated_or_existing',
      author: this.formatAuthorOutput(saved),
    };
  }

  async upsertPublication(input: CreatePublicationInput) {
    this.logger.log(
      `upsertPublication started title="${input.title}" doi="${input.doi ?? ''}"`,
    );
    const normalizedTitle = this.normalizeText(input.title);
    const fingerprint = this.buildFingerprint(
      normalizedTitle,
      input.publishedYear,
      input.journal,
    );
    const parsedAuthorIds =
      input.authorIds?.filter(Boolean).map((id) => new Types.ObjectId(id)) ?? [];

    const filter = input.doi?.trim()
      ? { doi: input.doi.trim() }
      : { fingerprint };

    const update = {
      $set: {
        title: input.title.trim(),
        normalizedTitle,
        doi: input.doi?.trim() || undefined,
        fingerprint,
        journal: input.journal?.trim() || undefined,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        publishedYear: input.publishedYear,
        authors: input.authors,
        citationCount: input.citationCount,
      },
      $addToSet: {
        authorIds: { $each: parsedAuthorIds },
        sourceRecords: { $each: input.sourceRecords ?? [] },
      },
    };

    const saved = await this.publicationModel
      .findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
      .lean()
      .exec();
    this.logger.log(`upsertPublication completed id=${saved?._id?.toString?.() ?? ''}`);
    return saved;
  }

  async listPublications(input: ListPublicationsInput = {}) {
    const {
      authorId,
      query,
      publishedFrom,
      publishedTo,
      publishedWithinYears,
    } = input;
    this.logger.log(
      `listPublications started authorId="${authorId ?? ''}" query="${query ?? ''}" publishedFrom="${publishedFrom?.toISOString() ?? ''}" publishedTo="${publishedTo?.toISOString() ?? ''}" publishedWithinYears="${publishedWithinYears ?? ''}"`,
    );
    const filter: Record<string, unknown> = {};

    if (authorId) {
      filter.authorIds = new Types.ObjectId(authorId);
    }

    if (query?.trim()) {
      const regex = new RegExp(this.escapeRegex(query.trim()), 'i');
      filter.title = regex;
    }

    if (publishedFrom || publishedTo) {
      const dateRangeFilter: Record<string, Date> = {};
      if (publishedFrom) {
        dateRangeFilter.$gte = publishedFrom;
      }
      if (publishedTo) {
        dateRangeFilter.$lte = publishedTo;
      }

      const yearRangeFilter: Record<string, number> = {};
      if (publishedFrom) {
        yearRangeFilter.$gte = publishedFrom.getUTCFullYear();
      }
      if (publishedTo) {
        yearRangeFilter.$lte = publishedTo.getUTCFullYear();
      }

      filter.$or = [{ publishedAt: dateRangeFilter }, { publishedYear: yearRangeFilter }];
    }

    const list = await this.publicationModel
      .find(filter)
      .sort({ publishedAt: -1, publishedYear: -1, updatedAt: -1 })
      .limit(100)
      .lean()
      .exec();
    this.logger.log(`listPublications completed count=${list.length}`);
    return list.map((item) => this.formatPublicationOutput(item));
  }

  async getPublicationById(id: string) {
    const publication = await this.publicationModel
      .findById(id)
      .populate('authorIds')
      .lean()
      .exec();

    if (!publication) {
      throw new NotFoundException('Makale bulunamadi.');
    }

    return this.formatPublicationOutput(publication);
  }

  private async loadAuthorDocumentOrThrow(id: string, label = 'Yazar') {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${label} id gecersiz.`);
    }

    const author = await this.authorModel.findById(id).exec();
    if (!author) {
      throw new NotFoundException(`${label} bulunamadi.`);
    }

    return author;
  }

  private mergeUniqueStrings(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const trimmed = value?.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLocaleLowerCase('tr-TR');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(trimmed);
    }

    return result;
  }

  private clonePlainRecords(items: Array<Record<string, unknown>>) {
    return items.map((item) => this.clonePlainObject(item));
  }

  private clonePlainObject<T extends Record<string, unknown>>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private buildParsedAffiliationMergeKey(item: Record<string, unknown>) {
    const raw = this.readStringFromObject(item, ['raw'])?.trim();
    const university = this.readStringFromObject(item, ['university'])?.trim();
    const city = this.readStringFromObject(item, ['city'])?.trim();
    const country = this.readStringFromObject(item, ['country'])?.trim();
    const platform =
      this.readStringFromObject(item, ['platform'])?.trim().toLowerCase() ?? '';

    return [raw ?? '', university ?? '', city ?? '', country ?? '', platform].join('|');
  }

  private mergeParsedAffiliations(
    ...groups: Array<Array<Record<string, unknown>> | undefined>
  ) {
    const map = new Map<string, Record<string, unknown>>();

    for (const group of groups) {
      for (const item of group ?? []) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const clone = this.clonePlainObject(item);
        const key = this.buildParsedAffiliationMergeKey(clone);
        if (!key || !map.has(key)) {
          map.set(key || JSON.stringify(clone), clone);
        }
      }
    }

    return Array.from(map.values());
  }

  private normalizeAdminSourceProfilePlatform(
    value?: string | null,
  ) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = trimmed.toLowerCase();
    if (normalized === 'web of science') {
      return 'clarivate_wos';
    }

    return normalized;
  }

  private sanitizeAdminSourceProfiles(input?: AdminSourceProfileInput[]) {
    const map = new Map<string, AdminSourceProfileInput>();

    for (const item of input ?? []) {
      const platform = this.normalizeAdminSourceProfilePlatform(
        item.platformKey ?? item.platform,
      );
      const externalAuthorId = item.externalAuthorId?.trim();
      if (!platform || !externalAuthorId) {
        continue;
      }

      const key = `${platform}:${externalAuthorId}`;
      if (map.has(key)) {
        continue;
      }

      map.set(key, {
        platform,
        externalAuthorId,
        profileUrl: item.profileUrl?.trim() || undefined,
        score:
          typeof item.score === 'number' && Number.isFinite(item.score)
            ? item.score
            : undefined,
        lastSyncedAt: item.lastSyncedAt,
      });
    }

    return Array.from(map.values());
  }

  private mergeSourceProfilesForAdmin(
    ...groups: Array<
      | Array<
          | AdminSourceProfileInput
          | {
              platform?: string;
              externalAuthorId?: string;
              profileUrl?: string;
              score?: number;
              lastSyncedAt?: Date;
            }
        >
      | undefined
    >
  ) {
    const merged: AdminSourceProfileInput[] = [];

    for (const group of groups) {
      for (const item of group ?? []) {
        const [sanitized] = this.sanitizeAdminSourceProfiles([
          {
            platform:
              'platformKey' in item && typeof item.platformKey === 'string'
                ? item.platformKey
                : item.platform,
            externalAuthorId: item.externalAuthorId,
            profileUrl: item.profileUrl,
            score: item.score,
            lastSyncedAt:
              item.lastSyncedAt instanceof Date
                ? item.lastSyncedAt.toISOString()
                : item.lastSyncedAt,
          },
        ]);

        if (!sanitized) {
          continue;
        }

        const exists = merged.some(
          (current) =>
            current.platform === sanitized.platform &&
            current.externalAuthorId === sanitized.externalAuthorId,
        );
        if (!exists) {
          merged.push(sanitized);
        }
      }
    }

    return merged;
  }

  private async applyAdminAuthorUpdate(
    authorDoc: AuthorDocument,
    input: AdminAuthorUpdateInput,
  ) {
    if (input.fullName !== undefined) {
      const fullName = input.fullName.trim();
      if (!fullName) {
        throw new BadRequestException('`fullName` bos birakilamaz.');
      }
      authorDoc.fullName = fullName;
      authorDoc.normalizedName = this.normalizeAuthorName(fullName);
    } else if (!authorDoc.normalizedName?.trim() && authorDoc.fullName?.trim()) {
      authorDoc.normalizedName = this.normalizeAuthorName(authorDoc.fullName);
    }

    if (input.aliases !== undefined) {
      authorDoc.aliases = this.mergeUniqueStrings(input.aliases).filter(
        (alias) => alias !== authorDoc.fullName,
      );
    }

    if (input.affiliations !== undefined) {
      authorDoc.affiliations = this.mergeUniqueStrings(input.affiliations);
    }

    if (input.parsedAffiliations !== undefined) {
      authorDoc.parsedAffiliations = this.mergeParsedAffiliations(
        input.parsedAffiliations,
      );
    }

    if (input.institutionAliases !== undefined) {
      authorDoc.institutionAliases = this.mergeUniqueStrings(
        input.institutionAliases,
      );
    }

    if (input.university !== undefined) {
      authorDoc.university = input.university?.trim() || undefined;
    }
    if (input.city !== undefined) {
      authorDoc.city = input.city?.trim() || undefined;
    }
    if (input.country !== undefined) {
      authorDoc.country = input.country?.trim() || undefined;
    }
    if (input.emailDomain !== undefined) {
      authorDoc.emailDomain = input.emailDomain?.trim() || undefined;
    }
    if (input.orcid !== undefined) {
      authorDoc.orcid = input.orcid?.trim() || undefined;
    }

    if (input.sourceProfiles !== undefined) {
      authorDoc.sourceProfiles = this.sanitizeAdminSourceProfiles(
        input.sourceProfiles,
      ).map((item) => ({
        platform: item.platform!,
        externalAuthorId: item.externalAuthorId!,
        profileUrl: item.profileUrl,
        score: item.score,
        lastSyncedAt: item.lastSyncedAt ? new Date(item.lastSyncedAt) : undefined,
      })) as typeof authorDoc.sourceProfiles;
    }

    const institution = await this.upsertInstitutionRecord(
      this.buildInstitutionInputsFromAuthor(authorDoc),
      {
        preferredCanonicalName: authorDoc.university,
        manualAliases: authorDoc.institutionAliases ?? [],
        city: authorDoc.city,
        country: authorDoc.country,
      },
    );

    if (institution) {
      authorDoc.institutionId = institution._id as Types.ObjectId;
      authorDoc.institutionCanonicalKey = institution.normalizedKey;
      authorDoc.institutionAliases = this.mergeUniqueStrings([
        ...(institution.aliases ?? []),
        ...(authorDoc.institutionAliases ?? []),
      ]);
      authorDoc.university = institution.canonicalName;
      authorDoc.city = authorDoc.city ?? institution.city ?? undefined;
      authorDoc.country = authorDoc.country ?? institution.country ?? undefined;
      authorDoc.parsedAffiliations = (authorDoc.parsedAffiliations ?? []).map(
        (item) => this.attachInstitutionMetadata(item, institution),
      );
    } else {
      authorDoc.institutionId = undefined;
      authorDoc.institutionCanonicalKey = undefined;
    }

    const manualSearchKeywords =
      input.searchKeywords !== undefined
        ? this.mergeUniqueStrings(input.searchKeywords)
        : authorDoc.searchKeywords ?? [];
    authorDoc.searchKeywords = this.buildAdminSearchKeywords(
      authorDoc,
      manualSearchKeywords,
    );
  }

  private buildAdminSearchKeywords(
    authorDoc: AuthorDocument,
    seedKeywords: string[] = [],
  ) {
    const keywords = new Set<string>();
    const addValue = (value?: string | null) => {
      for (const token of this.normalizeText(value ?? '').split(' ')) {
        const trimmed = token.trim();
        if (trimmed && trimmed.length > 1) {
          keywords.add(trimmed);
        }
      }
    };

    for (const keyword of seedKeywords) {
      addValue(keyword);
    }

    addValue(authorDoc.fullName);
    for (const alias of authorDoc.aliases ?? []) {
      addValue(alias);
    }
    for (const affiliation of authorDoc.affiliations ?? []) {
      addValue(affiliation);
    }
    for (const alias of authorDoc.institutionAliases ?? []) {
      addValue(alias);
    }
    addValue(authorDoc.university);
    addValue(authorDoc.city);
    addValue(authorDoc.country);
    addValue(authorDoc.emailDomain);

    for (const item of authorDoc.parsedAffiliations ?? []) {
      addValue(this.readStringFromObject(item, ['raw']) ?? undefined);
      addValue(this.readStringFromObject(item, ['university']) ?? undefined);
      addValue(this.readStringFromObject(item, ['city']) ?? undefined);
      addValue(this.readStringFromObject(item, ['country']) ?? undefined);
      addValue(this.readStringFromObject(item, ['emailDomain']) ?? undefined);
    }

    return Array.from(keywords);
  }

  private toObjectIdString(value: unknown) {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Types.ObjectId) {
      return value.toString();
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      '_id' in value &&
      (value as { _id?: unknown })._id
    ) {
      return this.toObjectIdString((value as { _id?: unknown })._id);
    }
    return null;
  }

  private async reassignPublicationOwnership(input: {
    fromAuthorId: string;
    toAuthorId: string;
    publicationIds?: string[];
    removeFromSource?: boolean;
  }) {
    const fromAuthorObjectId = new Types.ObjectId(input.fromAuthorId);
    const toAuthorObjectId = new Types.ObjectId(input.toAuthorId);
    const scopedPublicationIds = (input.publicationIds ?? [])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const filter: Record<string, unknown> = {
      authorIds: fromAuthorObjectId,
    };
    if (scopedPublicationIds.length > 0) {
      filter._id = { $in: scopedPublicationIds };
    }

    const publications = await this.publicationModel.find(filter).lean().exec();
    if (publications.length === 0) {
      return { updatedCount: 0, publicationIds: [] as string[] };
    }

    const operations = publications.flatMap((publication) => {
      const currentIds = new Set(
        (Array.isArray(publication.authorIds) ? publication.authorIds : [])
          .map((item) => this.toObjectIdString(item))
          .filter((item): item is string => Boolean(item)),
      );

      currentIds.add(input.toAuthorId);
      if (input.removeFromSource !== false) {
        currentIds.delete(input.fromAuthorId);
      }

      const nextIds = Array.from(currentIds)
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      return [
        {
          updateOne: {
            filter: { _id: publication._id },
            update: {
              $set: {
                authorIds: nextIds,
              },
            },
          },
        },
      ];
    });

    if (operations.length > 0) {
      await this.publicationModel.bulkWrite(operations);
    }

    return {
      updatedCount: publications.length,
      publicationIds: publications
        .map((publication) => publication._id?.toString?.())
        .filter((id): id is string => Boolean(id)),
    };
  }

  private async unlinkPublicationOwnership(input: {
    authorId: string;
    publicationIds?: string[];
  }) {
    const authorObjectId = new Types.ObjectId(input.authorId);
    const scopedPublicationIds = (input.publicationIds ?? [])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const filter: Record<string, unknown> = {
      authorIds: authorObjectId,
    };
    if (scopedPublicationIds.length > 0) {
      filter._id = { $in: scopedPublicationIds };
    }

    const publications = await this.publicationModel.find(filter).lean().exec();
    if (publications.length === 0) {
      return { updatedCount: 0, publicationIds: [] as string[] };
    }

    const operations = publications.map((publication) => {
      const nextIds = Array.from(
        new Set(
          (Array.isArray(publication.authorIds) ? publication.authorIds : [])
            .map((item) => this.toObjectIdString(item))
            .filter(
              (item): item is string =>
                Boolean(item) && item !== input.authorId,
            ),
        ),
      )
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      return {
        updateOne: {
          filter: { _id: publication._id },
          update: {
            $set: {
              authorIds: nextIds,
            },
          },
        },
      };
    });

    if (operations.length > 0) {
      await this.publicationModel.bulkWrite(operations);
    }

    return {
      updatedCount: publications.length,
      publicationIds: publications
        .map((publication) => publication._id?.toString?.())
        .filter((id): id is string => Boolean(id)),
    };
  }

  private async searchAuthorsInDb(
    query: string,
    limit = 50,
    filters: SearchAuthorsDbOnlyFilters = {},
  ) {
    const filter = this.buildAuthorSearchFilter(query, filters);

    return this.authorModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean()
      .exec();
  }

  private buildAuthorSearchFilter(
    query: string,
    filters: SearchAuthorsDbOnlyFilters = {},
  ) {
    const signature = this.buildAuthorSearchSignature(query);
    const regex = new RegExp(this.escapeRegex(query.trim()), 'i');
    const normalizedRegex = new RegExp(
      this.escapeRegex(signature.normalizedQuery),
      'i',
    );
    const nameClauses: Record<string, unknown>[] = [
      { fullName: regex },
      { normalizedName: normalizedRegex },
      { aliases: regex },
    ];

    if (signature.tokens.length > 1) {
      nameClauses.push({
        $and: signature.tokens.map((token) => ({
          normalizedName: new RegExp(`\\b${this.escapeRegex(token)}\\b`, 'i'),
        })),
      });
      nameClauses.push({
        searchKeywords: { $all: signature.tokens },
      });
    }

    if (signature.surname) {
      const surnameRegex = new RegExp(
        `\\b${this.escapeRegex(signature.surname)}\\b`,
        'i',
      );
      nameClauses.push(
        { fullName: surnameRegex },
        { normalizedName: surnameRegex },
        { aliases: surnameRegex },
        { searchKeywords: { $all: [signature.surname] } },
        { affiliations: surnameRegex },
        { 'sourceProfiles.externalAuthorId': surnameRegex },
      );
    }

    if (signature.surname && signature.givenTokens.length > 0) {
      const distinctiveGivenTokens = signature.givenTokens.slice(0, 2);
      nameClauses.push({
        $and: [
          { searchKeywords: { $all: [signature.surname] } },
          {
            $or: distinctiveGivenTokens.map((token) => ({
              searchKeywords: { $all: [token] },
            })),
          },
        ],
      });
    }

    if (signature.surname && signature.compactInitials) {
      const pubmedStyleRegex = new RegExp(
        `\\b${this.escapeRegex(signature.surname)}[\\s-]+${this.escapeRegex(signature.compactInitials)}\\b`,
        'i',
      );
      nameClauses.push(
        { searchKeywords: { $all: [signature.surname, signature.compactInitials] } },
        { 'sourceProfiles.externalAuthorId': pubmedStyleRegex },
      );
    }

    const andClauses: Record<string, unknown>[] = [{ $or: nameClauses }];

    if (signature.surname && signature.tokens.length >= 2) {
      const surnameRegex = new RegExp(
        `\\b${this.escapeRegex(signature.surname)}\\b`,
        'i',
      );
      andClauses.push({
        $or: [
          { normalizedName: surnameRegex },
          { fullName: surnameRegex },
          { aliases: surnameRegex },
          { searchKeywords: { $all: [signature.surname] } },
          { affiliations: surnameRegex },
        ],
      });
    }

    const filterClauses = this.buildAuthorFacetFilterClauses(filters);
    if (filterClauses.length > 0) {
      andClauses.push(...filterClauses);
    }

    return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
  }

  private readArrayFromObject(payload: unknown, keys: string[]) {
    if (!payload || typeof payload !== 'object') {
      return [] as Array<Record<string, unknown>>;
    }

    const obj = payload as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        );
      }
    }
    return [] as Array<Record<string, unknown>>;
  }

  private readStringFromObject(
    obj: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
      if (
        value &&
        typeof value === 'object' &&
        '_id' in (value as Record<string, unknown>)
      ) {
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
      }
      if (value != null && typeof value !== 'object') {
        return String(value);
      }
    }
    return null;
  }

  private readStringArrayFromObject(
    obj: Record<string, unknown>,
    keys: string[],
  ) {
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

  private buildAuthorSearchSignature(query: string): AuthorSearchSignature {
    const normalizedQuery = this.normalizeAuthorName(query);
    const tokens = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
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

  private buildAuthorFacetFilterClauses(filters: SearchAuthorsDbOnlyFilters) {
    const clauses: Record<string, unknown>[] = [];

    const countryValues = this.expandCountryFilterValues(filters.country);
    if (countryValues.length > 0) {
      clauses.push({
        $or: [
          ...countryValues.map((value) => ({
            country: new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i'),
          })),
          ...countryValues.map((value) => ({
            affiliations: new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i'),
          })),
          ...countryValues
            .map((value) => this.extractFacetSearchTokens(value))
            .filter((tokens) => tokens.length > 0)
            .map((tokens) => ({
              searchKeywords: { $all: tokens },
            })),
        ],
      });
    }

    const cityTokens = this.extractFacetSearchTokens(filters.city);
    if (cityTokens.length > 0) {
      clauses.push({
        $or: [
          ...cityTokens.map((value) => ({
            city: new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i'),
          })),
          ...cityTokens.map((value) => ({
            affiliations: new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i'),
          })),
          { searchKeywords: { $all: cityTokens } },
        ],
      });
    }

    const institutionTokens = this.extractFacetSearchTokens(
      filters.institution,
      true,
    );
    if (filters.institution?.trim()) {
      const institutionRegex = this.buildOrderedTokenRegex(institutionTokens);
      clauses.push({
        $or: [
          { institutionCanonicalKey: filters.institution.trim() },
          ...(institutionRegex
            ? [
                { university: institutionRegex },
                { institutionAliases: institutionRegex },
                { affiliations: institutionRegex },
              ]
            : []),
          ...(institutionTokens.length > 0
            ? [
                { searchKeywords: { $all: institutionTokens } },
              ]
            : []),
        ],
      });
    }

    return clauses;
  }

  private expandCountryFilterValues(value?: string) {
    const normalized = this.normalizeText(value ?? '').replace(/\s+/g, '');
    if (!normalized) {
      return [];
    }

    const aliases = FILTER_COUNTRY_ALIASES[normalized] ?? [normalized];
    return [...new Set(aliases.map((item) => this.normalizeText(item)).filter(Boolean))];
  }

  private extractFacetSearchTokens(
    value?: string,
    removeGenericTokens = false,
  ) {
    const raw = (value ?? '').replace(/^inst-/i, '').replace(/-/g, ' ');
    const normalized = this.normalizeText(raw);
    if (!normalized) {
      return [];
    }

    const tokens = normalized.split(' ').filter(Boolean);
    const filtered = removeGenericTokens
      ? tokens.filter((token) => !GENERIC_AUTHOR_FILTER_TOKENS.has(token))
      : tokens;

    return [...new Set(filtered)];
  }

  private buildOrderedTokenRegex(tokens: string[]) {
    if (tokens.length === 0) {
      return null;
    }

    const pattern = tokens.map((token) => this.escapeRegex(token)).join('.*');
    return new RegExp(pattern, 'i');
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

  private normalizeAuthorName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const normalizedCommaAware = trimmed.includes(',')
      ? (() => {
          const [left, right] = trimmed.split(',').map((part) => part.trim());
          if (!left || !right) {
            return trimmed;
          }
          return `${right} ${left}`;
        })()
      : trimmed;

    return normalizePersonName(normalizedCommaAware);
  }

  private mergeCanonicalAuthorName(
    authorDoc: AuthorDocument,
    incomingDisplayName: string,
    incomingNormalizedName: string,
  ) {
    const currentDisplayName = authorDoc.fullName?.trim() ?? '';
    const currentNormalizedName =
      authorDoc.normalizedName || this.normalizeAuthorName(currentDisplayName);
    const preferred = this.pickPreferredAuthorName(
      {
        displayName: currentDisplayName,
        normalizedName: currentNormalizedName,
      },
      {
        displayName: incomingDisplayName,
        normalizedName: incomingNormalizedName,
      },
    );

    const aliases = new Set(
      (authorDoc.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
    );
    for (const alias of [currentDisplayName, incomingDisplayName]) {
      if (alias && alias !== preferred.displayName) {
        aliases.add(alias);
      }
    }

    authorDoc.fullName = preferred.displayName;
    authorDoc.normalizedName = preferred.normalizedName;
    authorDoc.aliases = Array.from(aliases);
  }

  private pickPreferredAuthorName(
    current: { displayName: string; normalizedName: string },
    incoming: { displayName: string; normalizedName: string },
  ) {
    return this.scoreAuthorNameCandidate(current) >=
      this.scoreAuthorNameCandidate(incoming)
      ? current
      : incoming;
  }

  private scoreAuthorNameCandidate(candidate: {
    displayName: string;
    normalizedName: string;
  }) {
    const displayName = candidate.displayName?.trim() ?? '';
    if (!displayName || displayName.toLowerCase() === 'unknown') {
      return 0;
    }

    const normalizedName =
      this.normalizeAuthorName(displayName) || candidate.normalizedName;
    const tokens = normalizedName.split(' ').filter(Boolean);
    const longTokenCount = tokens.filter((token) => token.length > 2).length;
    const looksLikePubmedAbbreviation =
      tokens.length >= 2 &&
      ((tokens[0]?.length > 1 &&
        tokens[tokens.length - 1]?.length > 0 &&
        tokens[tokens.length - 1].length <= 3) ||
        (tokens[0]?.length > 0 &&
          tokens[0].length <= 3 &&
          tokens[tokens.length - 1]?.length > 1));
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
      (looksLikePubmedAbbreviation ? 40 : 0) -
      (hasSourceNoise ? 45 : 0)
    );
  }

  private async findBestExistingAuthorForDiscoveredInput(
    input: DiscoveredAuthorInput,
    incomingDisplayName: string,
    incomingNormalizedName: string,
  ) {
    const incomingTokens = [
      ...new Set(incomingNormalizedName.split(' ').filter(Boolean)),
    ];
    const surname = incomingTokens[incomingTokens.length - 1];
    const orClauses: Record<string, unknown>[] = [];

    if (incomingDisplayName.trim()) {
      const displayRegex = new RegExp(
        this.escapeRegex(incomingDisplayName.trim()),
        'i',
      );
      orClauses.push({ fullName: displayRegex }, { aliases: displayRegex });
    }

    if (incomingNormalizedName) {
      const normalizedRegex = new RegExp(
        this.escapeRegex(incomingNormalizedName),
        'i',
      );
      orClauses.push({ normalizedName: normalizedRegex });
    }

    if (surname) {
      const surnameRegex = new RegExp(this.escapeRegex(surname), 'i');
      orClauses.push(
        { fullName: surnameRegex },
        { normalizedName: surnameRegex },
        { aliases: surnameRegex },
      );
    }

    if (incomingTokens.length > 1) {
      orClauses.push({
        searchKeywords: { $all: incomingTokens.slice(0, Math.min(3, incomingTokens.length)) },
      });
    }

    const candidates = await this.authorModel
      .find(orClauses.length > 0 ? { $or: orClauses } : {})
      .limit(60)
      .exec();

    let best: AuthorDocument | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = this.scoreExistingAuthorForDiscoveredInput(
        candidate,
        input,
        incomingDisplayName,
        incomingNormalizedName,
      );
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return bestScore >= 0.82 ? best : null;
  }

  private scoreExistingAuthorForDiscoveredInput(
    candidate: AuthorDocument,
    input: DiscoveredAuthorInput,
    incomingDisplayName: string,
    incomingNormalizedName: string,
  ) {
    const plain = this.toPlainObject(candidate);
    const candidateNames = [
      this.readStringFromObject(plain, ['fullName']) ?? '',
      ...this.readStringArrayFromObject(plain, ['aliases']),
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    const exactNormalizedMatch =
      candidateNames.some(
        (value) => this.normalizeAuthorName(value) === incomingNormalizedName,
      ) ||
      (this.readStringFromObject(plain, ['normalizedName']) ?? '') ===
        incomingNormalizedName;
    const compatibleNameMatch = candidateNames.some((value) =>
      arePersonNamesCompatible(incomingDisplayName, value, {
        allowInitialSuffixMatch: true,
      }),
    );
    const sourceNoiseNameMatch = candidateNames.some((value) =>
      this.hasDisplayNameSourceNoise(value) &&
      this.normalizeAuthorNameWithoutSourceNoise(value) === incomingNormalizedName,
    );
    const subsetNameMatch = candidateNames.some((value) =>
      this.hasCompatibleNormalizedAuthorNames(
        incomingNormalizedName,
        this.normalizeAuthorName(value),
      ),
    );

    if (
      !exactNormalizedMatch &&
      !sourceNoiseNameMatch &&
      !compatibleNameMatch &&
      !subsetNameMatch
    ) {
      return 0;
    }

    if (this.hasStablePlatformProfileConflictWithPlainCandidate(plain, input)) {
      return 0;
    }

    const exactSourceProfileMatch = this.hasExactSourceProfileMatch(plain, input);

    const emailMatch =
      input.emailDomain?.trim() &&
      this.readStringFromObject(plain, ['emailDomain'])?.trim() &&
      input.emailDomain.trim().toLocaleLowerCase('tr-TR') ===
        this.readStringFromObject(plain, ['emailDomain'])!
          .trim()
          .toLocaleLowerCase('tr-TR');
    const institutionMatch = this.hasDiscoveredInstitutionMatch(input, plain);
    const locationMatch =
      input.city?.trim() &&
      input.country?.trim() &&
      this.readStringFromObject(plain, ['city'])?.trim() &&
      this.readStringFromObject(plain, ['country'])?.trim() &&
      this.normalizeText(input.city) ===
        this.normalizeText(this.readStringFromObject(plain, ['city']) ?? '') &&
      this.normalizeText(input.country) ===
        this.normalizeText(
          this.readStringFromObject(plain, ['country']) ?? '',
        );
    const affiliationMatch = this.hasDiscoveredAffiliationOverlap(input, plain);
    const institutionConflict = this.hasDiscoveredInstitutionConflict(
      input,
      plain,
    );
    const emailConflict = this.hasDiscoveredEmailConflict(input, plain);
    const exactLongNameCrossSourceBridge =
      this.hasExactLongNameCrossSourceBridge(
        candidateNames,
        plain,
        input,
        incomingDisplayName,
        incomingNormalizedName,
      );
    const sparseClarivateExactNameBridge =
      this.hasSparseClarivateExactNameBridge(
        plain,
        input,
        incomingNormalizedName,
      );
    const platformOverlap =
      input.sourceProfiles.length > 0 &&
      input.sourceProfiles.some((sourceProfile) =>
        this.readArrayFromObject(plain, ['sourceProfiles']).some((existing) => {
          const existingPlatform =
            this.readStringFromObject(existing, ['platform']) ?? '';
          return existingPlatform === sourceProfile.platform;
        }),
      );
    const exactNameCorroboration =
      exactSourceProfileMatch ||
      sourceNoiseNameMatch ||
      emailMatch ||
      institutionMatch ||
      locationMatch ||
      affiliationMatch ||
      exactLongNameCrossSourceBridge ||
      sparseClarivateExactNameBridge;

    if (exactNormalizedMatch && !exactNameCorroboration) {
      return 0;
    }

    if (
      exactNormalizedMatch &&
      institutionConflict &&
      !exactSourceProfileMatch &&
      !sourceNoiseNameMatch &&
      !(
        emailMatch ||
        affiliationMatch ||
        exactLongNameCrossSourceBridge ||
        sparseClarivateExactNameBridge
      )
    ) {
      return 0;
    }

    if (
      exactNormalizedMatch &&
      emailConflict &&
      !exactSourceProfileMatch &&
      !sourceNoiseNameMatch &&
      !(
        institutionMatch ||
        affiliationMatch ||
        exactLongNameCrossSourceBridge ||
        sparseClarivateExactNameBridge
      )
    ) {
      return 0;
    }

    let score = 0;

    if (exactNormalizedMatch) {
      score += 0.86;
    } else if (sourceNoiseNameMatch) {
      score += 0.84;
    } else if (compatibleNameMatch) {
      score += 0.52;
    } else if (subsetNameMatch) {
      score += 0.4;
    }

    if (emailMatch) {
      score += 0.24;
    }
    if (institutionMatch) {
      score += 0.22;
    }
    if (locationMatch) {
      score += 0.1;
    }
    if (affiliationMatch) {
      score += 0.16;
    }
    if (platformOverlap) {
      score += 0.06;
    }
    if (exactLongNameCrossSourceBridge) {
      score += 0.18;
    }
    if (sparseClarivateExactNameBridge) {
      score += 0.12 + this.candidateIdentityRichnessBonus(plain);
    }

    return score;
  }

  private hasExactLongNameCrossSourceBridge(
    candidateNames: string[],
    candidate: Record<string, unknown>,
    input: DiscoveredAuthorInput,
    incomingDisplayName: string,
    incomingNormalizedName: string,
  ) {
    const tokens = incomingNormalizedName.split(' ').filter(Boolean);
    if (tokens.length < 3) {
      return false;
    }

    const candidateNormalizedName =
      this.readStringFromObject(candidate, ['normalizedName']) ?? '';
    const exactNameMatch =
      candidateNormalizedName === incomingNormalizedName ||
      candidateNames.some(
        (value) => this.normalizeAuthorName(value) === incomingNormalizedName,
      );
    if (!exactNameMatch || this.hasDiscoveredEmailConflict(input, candidate)) {
      return false;
    }

    const incomingHasContext = this.hasDiscoveredMeaningfulIdentityContext(input);
    const candidateHasContext = this.hasCandidateMeaningfulIdentityContext(
      candidate,
    );
    const incomingHasEmail = Boolean(input.emailDomain?.trim());
    const candidateHasEmail = Boolean(
      this.readStringFromObject(candidate, ['emailDomain'])?.trim(),
    );
    const incomingHasSourceNoise =
      this.hasDisplayNameSourceNoise(incomingDisplayName);
    const candidateHasSourceNoise = candidateNames.some((value) =>
      this.hasDisplayNameSourceNoise(value),
    );

    return Boolean(
      (incomingHasEmail && candidateHasContext) ||
        (candidateHasEmail && incomingHasContext) ||
        ((incomingHasSourceNoise || candidateHasSourceNoise) &&
          (incomingHasContext || candidateHasContext)),
    );
  }

  private hasSparseClarivateExactNameBridge(
    candidate: Record<string, unknown>,
    input: DiscoveredAuthorInput,
    incomingNormalizedName: string,
  ) {
    if (!this.isSparseClarivateDiscoveredInput(input, incomingNormalizedName)) {
      return false;
    }

    const candidateNormalizedName =
      this.readStringFromObject(candidate, ['normalizedName']) ?? '';
    if (
      candidateNormalizedName !== incomingNormalizedName &&
      !this.readStringArrayFromObject(candidate, ['aliases']).some(
        (value) => this.normalizeAuthorName(value) === incomingNormalizedName,
      ) &&
      this.normalizeAuthorName(
        this.readStringFromObject(candidate, ['fullName']) ?? '',
      ) !== incomingNormalizedName
    ) {
      return false;
    }

    if (this.hasDiscoveredEmailConflict(input, candidate)) {
      return false;
    }

    return Boolean(
      this.hasCandidateMeaningfulIdentityContext(candidate) ||
        this.readStringFromObject(candidate, ['emailDomain'])?.trim() ||
        this.readArrayFromObject(candidate, ['sourceProfiles']).length > 1,
    );
  }

  private isSparseClarivateDiscoveredInput(
    input: DiscoveredAuthorInput,
    incomingNormalizedName: string,
  ) {
    const normalizedPlatforms = new Set(
      (input.sourceProfiles ?? [])
        .map((profile) => this.normalizeStableAuthorPlatform(profile.platform))
        .filter((value): value is string => Boolean(value)),
    );
    if (!normalizedPlatforms.has('clarivate_wos')) {
      return false;
    }

    const tokens = incomingNormalizedName.split(' ').filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) {
      return false;
    }

    return !this.hasDiscoveredMeaningfulIdentityContext(input);
  }

  private hasDiscoveredMeaningfulIdentityContext(input: DiscoveredAuthorInput) {
    if (input.university?.trim() || input.city?.trim() || input.country?.trim()) {
      return true;
    }

    return (input.parsedAffiliations ?? []).some((item) =>
      Boolean(
        this.readStringFromObject(item, ['university']) ??
          this.readStringFromObject(item, ['institutionCanonicalName']) ??
          this.readStringFromObject(item, ['institutionCanonicalKey']) ??
          this.readStringFromObject(item, ['city']) ??
          this.readStringFromObject(item, ['country']),
      ),
    );
  }

  private hasCandidateMeaningfulIdentityContext(
    candidate: Record<string, unknown>,
  ) {
    if (
      this.readStringFromObject(candidate, ['university'])?.trim() ||
      this.readStringFromObject(candidate, ['city'])?.trim() ||
      this.readStringFromObject(candidate, ['country'])?.trim()
    ) {
      return true;
    }

    return this.readArrayFromObject(candidate, ['parsedAffiliations']).some((item) =>
      Boolean(
        this.readStringFromObject(item, ['university']) ??
          this.readStringFromObject(item, ['institutionCanonicalName']) ??
          this.readStringFromObject(item, ['institutionCanonicalKey']) ??
          this.readStringFromObject(item, ['city']) ??
          this.readStringFromObject(item, ['country']),
      ),
    );
  }

  private candidateIdentityRichnessBonus(candidate: Record<string, unknown>) {
    let bonus = 0;

    if (this.hasCandidateMeaningfulIdentityContext(candidate)) {
      bonus += 0.04;
    }
    if (this.readStringFromObject(candidate, ['emailDomain'])?.trim()) {
      bonus += 0.04;
    }

    const profileCount = this.readArrayFromObject(candidate, [
      'sourceProfiles',
    ]).length;
    bonus += Math.min(profileCount, 3) * 0.02;

    return bonus;
  }

  private normalizeAuthorNameWithoutSourceNoise(value: string) {
    const cleaned = value.replace(
      /\b(google scholar|google akademik|scholar|akademik|citations?)\b/gi,
      ' ',
    );
    return this.normalizeAuthorName(cleaned.replace(/\s+-\s+/g, ' '));
  }

  private hasDisplayNameSourceNoise(value: string) {
    return /\b(google scholar|google akademik|scholar|akademik|citations?)\b/i.test(
      value,
    );
  }

  private hasStablePlatformProfileConflictWithExisting(
    candidate: AuthorDocument,
    input: DiscoveredAuthorInput,
  ) {
    return this.hasStablePlatformProfileConflictWithPlainCandidate(
      this.toPlainObject(candidate),
      input,
    );
  }

  private hasStablePlatformProfileConflictWithPlainCandidate(
    candidate: Record<string, unknown>,
    input: DiscoveredAuthorInput,
  ) {
    const existingProfiles = this.collectStablePlatformProfileIdsFromPlain(
      candidate,
    );
    const incomingProfiles = this.collectStablePlatformProfileIdsFromInput(input);

    for (const [platform, existingIds] of existingProfiles.entries()) {
      const incomingIds = incomingProfiles.get(platform);
      if (!incomingIds || incomingIds.size === 0) {
        continue;
      }

      const shared = Array.from(existingIds).some((id) => incomingIds.has(id));
      if (!shared) {
        return true;
      }
    }

    return false;
  }

  private hasExactSourceProfileMatch(
    candidate: Record<string, unknown>,
    input: DiscoveredAuthorInput,
  ) {
    const existingProfiles = this.readArrayFromObject(candidate, ['sourceProfiles']);

    for (const incomingProfile of input.sourceProfiles ?? []) {
      const incomingPlatform = incomingProfile.platform?.trim();
      const incomingExternalAuthorId = incomingProfile.externalAuthorId?.trim();
      if (!incomingPlatform || !incomingExternalAuthorId) {
        continue;
      }

      const hasMatch = existingProfiles.some((existing) => {
        const existingPlatform =
          this.readStringFromObject(existing, ['platform']) ?? '';
        const existingExternalAuthorId =
          this.readStringFromObject(existing, ['externalAuthorId']) ?? '';
        return (
          existingPlatform === incomingPlatform &&
          existingExternalAuthorId === incomingExternalAuthorId
        );
      });

      if (hasMatch) {
        return true;
      }
    }

    return false;
  }

  private collectStablePlatformProfileIdsFromPlain(
    candidate: Record<string, unknown>,
  ) {
    const profiles = this.readArrayFromObject(candidate, ['sourceProfiles']);
    const map = new Map<string, Set<string>>();

    for (const profile of profiles) {
      const platform = this.normalizeStableAuthorPlatform(
        this.readStringFromObject(profile, ['platform']) ?? undefined,
      );
      const externalAuthorId =
        this.readStringFromObject(profile, ['externalAuthorId']) ?? undefined;

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

  private collectStablePlatformProfileIdsFromInput(input: DiscoveredAuthorInput) {
    const map = new Map<string, Set<string>>();

    for (const profile of input.sourceProfiles ?? []) {
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

  private hasCompatibleNormalizedAuthorNames(left: string, right: string) {
    if (!left || !right) {
      return false;
    }

    if (left === right) {
      return true;
    }

    const leftTokens = left.split(' ').filter(Boolean);
    const rightTokens = right.split(' ').filter(Boolean);
    if (leftTokens.length < 2 || rightTokens.length < 2) {
      return false;
    }

    const smaller =
      leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const larger =
      leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;

    return smaller.every((token) => larger.includes(token));
  }

  private hasDiscoveredInstitutionMatch(
    input: DiscoveredAuthorInput,
    candidate: Record<string, unknown>,
  ) {
    const incomingResolved = this.resolveBestInstitutionIdentity(
      this.buildInstitutionInputsFromDiscoveredAuthor(input),
    );
    const candidateInstitution = this.pickAuthorInstitutionDisplayName(
      candidate,
      this.readArrayFromObject(candidate, ['parsedAffiliations']),
    );

    if (!incomingResolved?.canonicalName || !candidateInstitution) {
      return false;
    }

    return this.areInstitutionNamesCompatible(
      incomingResolved.canonicalName,
      candidateInstitution,
    );
  }

  private hasDiscoveredInstitutionConflict(
    input: DiscoveredAuthorInput,
    candidate: Record<string, unknown>,
  ) {
    const incomingResolved = this.resolveBestInstitutionIdentity(
      this.buildInstitutionInputsFromDiscoveredAuthor(input),
    );
    const candidateInstitution = this.pickAuthorInstitutionDisplayName(
      candidate,
      this.readArrayFromObject(candidate, ['parsedAffiliations']),
    );

    if (!incomingResolved?.canonicalName || !candidateInstitution) {
      return false;
    }

    return !this.areInstitutionNamesCompatible(
      incomingResolved.canonicalName,
      candidateInstitution,
    );
  }

  private hasDiscoveredEmailConflict(
    input: DiscoveredAuthorInput,
    candidate: Record<string, unknown>,
  ) {
    const incomingEmailDomain = input.emailDomain?.trim().toLocaleLowerCase('tr-TR');
    const candidateEmailDomain = this.readStringFromObject(candidate, [
      'emailDomain',
    ])
      ?.trim()
      .toLocaleLowerCase('tr-TR');

    if (!incomingEmailDomain || !candidateEmailDomain) {
      return false;
    }

    return incomingEmailDomain !== candidateEmailDomain;
  }

  private hasDiscoveredAffiliationOverlap(
    input: DiscoveredAuthorInput,
    candidate: Record<string, unknown>,
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
    const collectTokens = (items: Array<Record<string, unknown>>) => {
      const tokens = new Set<string>();
      for (const item of items) {
        const rawTokens = this.readStringArrayFromObject(item, ['tokens']);
        for (const token of rawTokens) {
          const normalized = token.trim().toLocaleLowerCase('tr-TR');
          if (normalized.length <= 2 || weakTokens.has(normalized)) {
            continue;
          }
          tokens.add(normalized);
        }
      }
      return tokens;
    };

    const leftTokens = collectTokens(input.parsedAffiliations ?? []);
    const rightTokens = collectTokens(
      this.readArrayFromObject(candidate, ['parsedAffiliations']),
    );

    if (leftTokens.size === 0 || rightTokens.size === 0) {
      return false;
    }

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

  private buildInstitutionInputsFromDiscoveredAuthor(
    input: DiscoveredAuthorInput,
  ): InstitutionNameInput[] {
    const inputs: InstitutionNameInput[] = [];

    if (input.university?.trim()) {
      inputs.push({
        name: input.university.trim(),
        city: input.city,
        country: input.country,
        confidence: 10,
      });
    }

    for (const alias of input.institutionAliases ?? []) {
      if (!alias?.trim() || !isLikelyInstitutionName(alias)) {
        continue;
      }
      inputs.push({
        name: alias.trim(),
        city: input.city,
        country: input.country,
        confidence: 2,
      });
    }

    for (const item of input.parsedAffiliations ?? []) {
      const name = this.extractInstitutionCandidateNameFromAffiliation(item);
      if (!name) {
        continue;
      }
      inputs.push({
        name,
        platform: this.readStringFromObject(item, ['platform']) ?? undefined,
        city:
          this.readStringFromObject(item, ['city']) ??
          input.city ??
          undefined,
        country:
          this.readStringFromObject(item, ['country']) ??
          input.country ??
          undefined,
        confidence: this.readStringFromObject(item, ['university'])
          ? 8
          : 6,
      });
    }

    return inputs;
  }

  private buildInstitutionInputsFromAuthor(author: AuthorDocument) {
    const plain = this.toPlainObject(author);
    const inputs: InstitutionNameInput[] = [];
    const city = this.readStringFromObject(plain, ['city']) ?? undefined;
    const country = this.readStringFromObject(plain, ['country']) ?? undefined;
    const university =
      this.readStringFromObject(plain, ['university']) ?? undefined;

    if (university) {
      inputs.push({ name: university, city, country, confidence: 10 });
    }

    for (const alias of this.readStringArrayFromObject(plain, [
      'institutionAliases',
    ])) {
      if (!isLikelyInstitutionName(alias)) {
        continue;
      }
      inputs.push({ name: alias, city, country, confidence: 2 });
    }

    for (const rawAffiliation of this.readStringArrayFromObject(plain, [
      'affiliations',
    ])) {
      const name = this.extractInstitutionCandidateNameFromAffiliation({
        raw: rawAffiliation,
      });
      if (!name) {
        continue;
      }
      inputs.push({ name, city, country, confidence: 6 });
    }

    const parsedAffiliations = Array.isArray(plain.parsedAffiliations)
      ? (plain.parsedAffiliations as Array<Record<string, unknown>>)
      : [];

    for (const item of parsedAffiliations) {
      const name = this.extractInstitutionCandidateNameFromAffiliation(item);
      if (!name) {
        continue;
      }
      inputs.push({
        name,
        platform: this.readStringFromObject(item, ['platform']) ?? undefined,
        city: this.readStringFromObject(item, ['city']) ?? city,
        country: this.readStringFromObject(item, ['country']) ?? country,
        confidence: this.readStringFromObject(item, ['university']) ? 8 : 6,
      });
    }

    return inputs;
  }

  private buildInstitutionInputsFromInstitutionRecord(
    institution: InstitutionDocument,
  ) {
    return this.buildInstitutionInputsFromInstitutionPlain(
      this.toPlainObject(institution),
    );
  }

  private buildInstitutionInputsFromInstitutionPlain(
    plain: Record<string, unknown>,
  ) {
    const inputs: InstitutionNameInput[] = [];
    const city = this.readStringFromObject(plain, ['city']) ?? undefined;
    const country = this.readStringFromObject(plain, ['country']) ?? undefined;
    const canonicalName =
      this.readStringFromObject(plain, ['canonicalName']) ?? undefined;

    if (canonicalName?.trim()) {
      inputs.push({
        name: canonicalName.trim(),
        city,
        country,
        confidence: 10,
      });
    }

    for (const alias of this.readStringArrayFromObject(plain, ['aliases'])) {
      if (!alias?.trim()) {
        continue;
      }
      inputs.push({ name: alias.trim(), city, country, confidence: 7 });
    }

    for (const alias of this.readStringArrayFromObject(plain, ['manualAliases'])) {
      if (!alias?.trim()) {
        continue;
      }
      inputs.push({ name: alias.trim(), city, country, confidence: 9 });
    }

    const platformAliases = Array.isArray(plain.platformAliases)
      ? (plain.platformAliases as Array<Record<string, unknown>>)
      : [];
    for (const platformAlias of platformAliases) {
      const names = this.readStringArrayFromObject(platformAlias, ['names']);
      const platform =
        this.readStringFromObject(platformAlias, ['platform']) ?? undefined;
      for (const name of names) {
        if (!name?.trim()) {
          continue;
        }
        inputs.push({
          name: name.trim(),
          platform,
          city,
          country,
          confidence: 7,
        });
      }
    }

    return inputs;
  }

  private async upsertInstitutionRecord(
    inputs: InstitutionNameInput[],
    options: {
      preferredCanonicalName?: string;
      manualAliases?: string[];
      canonicalLocked?: boolean;
      city?: string;
      country?: string;
      minimumConfidence?: number;
    } = {},
  ) {
    const resolved = this.resolveBestInstitutionIdentity(inputs, {
      minimumConfidence: options.minimumConfidence ?? 0,
    });
    if (!resolved) {
      return null;
    }
    const preferredResolution = options.preferredCanonicalName?.trim()
      ? resolveInstitutionIdentity([
          {
            name: options.preferredCanonicalName.trim(),
            city: options.city,
            country: options.country,
          },
          ...((options.manualAliases ?? []).map((alias) => ({
            name: alias,
            city: options.city,
            country: options.country,
          })) as InstitutionNameInput[]),
        ])
      : null;

    const exactNames = [
      resolved.canonicalName,
      ...resolved.aliases,
      ...(options.preferredCanonicalName ? [options.preferredCanonicalName] : []),
      ...((options.manualAliases ?? []).filter(Boolean) as string[]),
    ];
    let institutionDoc = await this.institutionModel
      .findOne({
        $or: [
          { normalizedKey: resolved.normalizedKey },
          { matchKeys: { $in: resolved.matchKeys } },
          { canonicalName: { $in: exactNames } },
          { aliases: { $in: exactNames } },
          { manualAliases: { $in: exactNames } },
        ],
      })
      .exec();

    const createInstitutionRecord = async () => {
      const manualAliases = [
        ...new Set(
          (options.manualAliases ?? [])
            .map((alias) => alias.trim())
            .filter(
              (alias) =>
                !!alias &&
                alias !==
                  (options.preferredCanonicalName ?? resolved.canonicalName),
            ),
        ),
      ];

      const nextInstitutionDoc = new this.institutionModel({
        canonicalName:
          options.preferredCanonicalName?.trim() || resolved.canonicalName,
        normalizedKey:
          preferredResolution?.normalizedKey ?? resolved.normalizedKey,
        aliases: resolved.aliases,
        manualAliases,
        matchKeys: [
          ...new Set([
            ...resolved.matchKeys,
            ...(preferredResolution?.matchKeys ?? []),
          ]),
        ],
        platformAliases: resolved.platformAliases,
        canonicalLocked: options.canonicalLocked ?? false,
        city: options.city ?? resolved.city,
        country: options.country ?? resolved.country,
      });

      return nextInstitutionDoc.save();
    };

    if (
      institutionDoc &&
      !this.areInstitutionNamesCompatible(
        institutionDoc.canonicalName,
        resolved.canonicalName,
      )
    ) {
      institutionDoc = null;
    }

    if (!institutionDoc) {
      return createInstitutionRecord();
    }

    const existingCanonicalName =
      institutionDoc.canonicalName?.trim() || resolved.canonicalName;
    const mergedResolved =
      resolveInstitutionIdentity([
        ...this.filterInstitutionInputsToCanonicalCluster(
          this.buildInstitutionInputsFromInstitutionRecord(institutionDoc),
          existingCanonicalName,
        ),
        ...inputs,
      ]) ?? resolved;

    const manualAliases = [
      ...new Set(
        [
          ...(institutionDoc.manualAliases ?? []),
          ...(options.manualAliases ?? []),
        ]
          .map((alias) => alias.trim())
          .filter(Boolean),
      ),
    ];
    const preferredCanonicalName = options.preferredCanonicalName?.trim();
    const canonicalLocked =
      institutionDoc.canonicalLocked || options.canonicalLocked === true;

    const nextCanonicalName = canonicalLocked
      ? preferredCanonicalName || institutionDoc.canonicalName || mergedResolved.canonicalName
      : this.areInstitutionNamesCompatible(
            institutionDoc.canonicalName,
            preferredCanonicalName || mergedResolved.canonicalName,
          )
        ? pickPreferredInstitutionName(
            institutionDoc.canonicalName,
            preferredCanonicalName || mergedResolved.canonicalName,
          ) ?? institutionDoc.canonicalName
        : preferredCanonicalName || mergedResolved.canonicalName;

    institutionDoc.canonicalName = nextCanonicalName;
    institutionDoc.normalizedKey = canonicalLocked
      ? institutionDoc.normalizedKey ||
        preferredResolution?.normalizedKey ||
        mergedResolved.normalizedKey
      : mergedResolved.normalizedKey || institutionDoc.normalizedKey;
    institutionDoc.aliases = mergedResolved.aliases.filter(
      (alias) => alias !== institutionDoc.canonicalName,
    );
    institutionDoc.manualAliases = manualAliases.filter(
      (alias) => alias !== institutionDoc.canonicalName,
    );
    institutionDoc.matchKeys = [
      ...new Set([
        ...mergedResolved.matchKeys,
        ...(preferredResolution?.matchKeys ?? []),
      ]),
    ];
    institutionDoc.platformAliases = mergedResolved.platformAliases as never;
    institutionDoc.canonicalLocked = canonicalLocked;
    institutionDoc.city =
      institutionDoc.city ?? options.city ?? mergedResolved.city;
    institutionDoc.country =
      institutionDoc.country ?? options.country ?? mergedResolved.country;

    return institutionDoc.save();
  }

  private extractInstitutionCandidateNameFromAffiliation(
    item: Record<string, unknown>,
  ) {
    const canonical =
      this.readStringFromObject(item, [
        'institutionCanonicalName',
        'university',
      ]) ?? undefined;
    if (canonical?.trim()) {
      return extractInstitutionNameCandidate(canonical.trim());
    }

    const raw = this.readStringFromObject(item, ['raw']) ?? undefined;
    if (!raw?.trim()) {
      return null;
    }

    return extractInstitutionNameCandidate(raw);
  }

  private extractInstitutionCandidateNameFromRawAffiliation(
    raw?: string | null,
  ) {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return null;
    }

    return extractInstitutionNameCandidate(trimmed);
  }

  private areInstitutionNamesCompatible(
    left?: string | null,
    right?: string | null,
  ) {
    const normalizedLeft = left?.trim();
    const normalizedRight = right?.trim();

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return (
      normalizedLeft === normalizedRight ||
      areInstitutionNamesEquivalent(normalizedLeft, normalizedRight)
    );
  }

  private filterInstitutionInputsToCanonicalCluster(
    inputs: InstitutionNameInput[],
    canonicalName: string,
  ) {
    return inputs.filter((input) =>
      this.areInstitutionNamesCompatible(input.name, canonicalName),
    );
  }

  private buildInstitutionDisplayInputs(
    plain: Record<string, unknown>,
    parsedAffiliations: Array<Record<string, unknown>>,
  ) {
    const inputs: InstitutionNameInput[] = [];
    const fallbackCity =
      this.readStringFromObject(plain, ['city']) ?? undefined;
    const fallbackCountry =
      this.readStringFromObject(plain, ['country']) ?? undefined;
    const pushInput = (
      name: string | null | undefined,
      confidence: number,
      city?: string,
      country?: string,
      platform?: string,
    ) => {
      const trimmed = name?.trim();
      if (!trimmed) {
        return;
      }

      const extracted = extractInstitutionNameCandidate(trimmed);
      if (!extracted) {
        return;
      }

      inputs.push({
        name: extracted,
        confidence,
        city,
        country,
        platform,
      });
    };

    pushInput(
      this.readStringFromObject(plain, ['university']),
      4,
      fallbackCity,
      fallbackCountry,
    );

    for (const rawAffiliation of this.readStringArrayFromObject(plain, [
      'affiliations',
    ])) {
      pushInput(rawAffiliation, 14, fallbackCity, fallbackCountry);
    }

    for (const alias of this.readStringArrayFromObject(plain, [
      'institutionAliases',
    ])) {
      pushInput(alias, 1, fallbackCity, fallbackCountry);
    }

    for (const item of parsedAffiliations) {
      const city =
        this.readStringFromObject(item, ['city']) ?? fallbackCity;
      const country =
        this.readStringFromObject(item, ['country']) ?? fallbackCountry;
      const platform =
        this.readStringFromObject(item, ['platform']) ?? undefined;
      const rawInstitution = this.extractInstitutionCandidateNameFromRawAffiliation(
        this.readStringFromObject(item, ['raw']) ?? undefined,
      );

      if (rawInstitution) {
        inputs.push({
          name: rawInstitution,
          confidence: 16,
          city,
          country,
          platform,
        });
      }

      const itemUniversity =
        this.readStringFromObject(item, ['university']) ??
        this.readStringFromObject(item, ['institutionCanonicalName']) ??
        undefined;
      if (itemUniversity?.trim()) {
        pushInput(
          itemUniversity,
          rawInstitution
            ? this.areInstitutionNamesCompatible(itemUniversity, rawInstitution)
              ? 10
              : 2
            : 8,
          city,
          country,
          platform,
        );
      }
    }

    return inputs;
  }

  private pickAuthorInstitutionDisplayName(
    plain: Record<string, unknown>,
    parsedAffiliations: Array<Record<string, unknown>>,
  ) {
    const resolved = this.resolveBestInstitutionIdentity(
      this.buildInstitutionDisplayInputs(plain, parsedAffiliations),
    );

    if (resolved?.canonicalName?.trim()) {
      return resolved.canonicalName;
    }

    return this.pickPreferredProfileValue([
      this.readStringFromObject(plain, ['university']),
      ...parsedAffiliations.map((item) =>
        this.readStringFromObject(item, ['university']),
      ),
    ]);
  }

  private filterParsedAffiliationsForInstitution(
    parsedAffiliations: Array<Record<string, unknown>>,
    institutionName?: string,
  ) {
    const normalizedInstitution = institutionName?.trim();
    if (!normalizedInstitution) {
      return parsedAffiliations;
    }

    const matches = parsedAffiliations.filter((item) => {
      const rawInstitution = this.extractInstitutionCandidateNameFromRawAffiliation(
        this.readStringFromObject(item, ['raw']) ?? undefined,
      );
      const parsedInstitution =
        this.readStringFromObject(item, ['university']) ??
        this.readStringFromObject(item, ['institutionCanonicalName']) ??
        undefined;

      return [rawInstitution, parsedInstitution].some((value) =>
        this.areInstitutionNamesCompatible(value, normalizedInstitution),
      );
    });

    return matches.length > 0 ? matches : parsedAffiliations;
  }

  private resolveBestInstitutionIdentity(
    inputs: InstitutionNameInput[],
    options: { minimumConfidence?: number } = {},
  ) {
    const sanitized = inputs
      .map((input) => {
        const extracted = input.name?.trim()
          ? extractInstitutionNameCandidate(input.name.trim())
          : null;
        if (!extracted) {
          return null;
        }
        return {
          ...input,
          name: extracted,
          confidence: input.confidence ?? 1,
        };
      })
      .filter(
        (
          item,
        ): item is InstitutionNameInput & { name: string; confidence: number } =>
          !!item,
      );

    if (sanitized.length === 0) {
      return null;
    }

    const clusters: Array<
      Array<InstitutionNameInput & { name: string; confidence: number }>
    > = [];

    for (const input of sanitized) {
      const cluster = clusters.find((items) =>
        items.some((item) => areInstitutionNamesEquivalent(item.name, input.name)),
      );
      if (cluster) {
        cluster.push(input);
        continue;
      }
      clusters.push([input]);
    }

    const ranked = clusters
      .map((cluster) => {
        const resolved = resolveInstitutionIdentity(cluster);
        if (!resolved) {
          return null;
        }

        const totalConfidence = cluster.reduce(
          (sum, item) => sum + (item.confidence ?? 1),
          0,
        );
        const strongestSignal = Math.max(
          ...cluster.map((item) => item.confidence ?? 1),
        );

        return {
          cluster,
          resolved,
          totalConfidence,
          strongestSignal,
        };
      })
      .filter(
        (
          item,
        ): item is {
          cluster: Array<InstitutionNameInput & { name: string; confidence: number }>;
          resolved: NonNullable<ReturnType<typeof resolveInstitutionIdentity>>;
          totalConfidence: number;
          strongestSignal: number;
        } => !!item,
      )
      .sort((left, right) => {
        if (right.strongestSignal !== left.strongestSignal) {
          return right.strongestSignal - left.strongestSignal;
        }
        if (right.totalConfidence !== left.totalConfidence) {
          return right.totalConfidence - left.totalConfidence;
        }
        return right.resolved.canonicalName.length - left.resolved.canonicalName.length;
      });

    const best = ranked[0];
    if (!best) {
      return null;
    }
    if (
      options.minimumConfidence &&
      best.strongestSignal < options.minimumConfidence
    ) {
      return null;
    }

    return best.resolved;
  }

  private attachInstitutionMetadata(
    item: Record<string, unknown>,
    institution: InstitutionDocument,
  ) {
    const currentName = this.extractInstitutionCandidateNameFromAffiliation(item);
    if (
      currentName &&
      !areInstitutionNamesEquivalent(currentName, institution.canonicalName) &&
      currentName !== institution.canonicalName
    ) {
      return item;
    }

    return {
      ...item,
      university: institution.canonicalName,
      institutionId: institution._id.toString(),
      institutionCanonicalName: institution.canonicalName,
      institutionCanonicalKey: institution.normalizedKey,
    };
  }

  private extractInstitutionKeywords(institution: InstitutionDocument) {
    const keywords = new Set<string>();
    for (const value of [institution.canonicalName, ...(institution.aliases ?? [])]) {
      for (const token of this.normalizeText(value).split(' ')) {
        if (token) {
          keywords.add(token);
        }
      }
    }
    return Array.from(keywords);
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

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private formatAuthorOutput(author: unknown) {
    const plain = this.toPlainObject(author);
    const sourceProfiles = Array.isArray(plain.sourceProfiles)
      ? (plain.sourceProfiles as Array<Record<string, unknown>>)
      : [];
    const parsedAffiliations = this.readArrayFromObject(plain, [
      'parsedAffiliations',
    ]);
    const institutionId =
      this.readStringFromObject(plain, ['institutionId']) ?? undefined;
    const institutionCanonicalKey =
      this.readStringFromObject(plain, ['institutionCanonicalKey']) ?? undefined;
    const institutionAliases = this.readStringArrayFromObject(plain, [
      'institutionAliases',
    ]);
    const university = this.readStringFromObject(plain, ['university']) ?? undefined;
    const profile = this.buildAuthorProfile(plain, parsedAffiliations);
    const displayUniversity = profile.institutionName ?? university;

    const platformIdsRaw: Record<string, string[]> = {};

    for (const sourceProfile of sourceProfiles) {
      const platform =
        typeof sourceProfile.platform === 'string'
          ? sourceProfile.platform
          : null;
      const externalAuthorId =
        typeof sourceProfile.externalAuthorId === 'string'
          ? sourceProfile.externalAuthorId
          : null;

      if (!platform || !externalAuthorId) {
        continue;
      }

      if (!platformIdsRaw[platform]) {
        platformIdsRaw[platform] = [];
      }
      if (!platformIdsRaw[platform].includes(externalAuthorId)) {
        platformIdsRaw[platform].push(externalAuthorId);
      }
    }

    const formattedSourceProfiles = sourceProfiles.map((sourceProfile) =>
      this.formatSourceProfileOutput(sourceProfile),
    );
    const platformIds = Object.fromEntries(
      Object.entries(platformIdsRaw).map(([platform, ids]) => [
        this.getPlatformDisplayName(platform),
        ids,
      ]),
    );

    return {
      ...plain,
      sourceProfiles: formattedSourceProfiles,
      university: displayUniversity,
      city: profile.city ?? (this.readStringFromObject(plain, ['city']) ?? undefined),
      country:
        profile.country ?? (this.readStringFromObject(plain, ['country']) ?? undefined),
      profile,
      profileSummaryParts: this.buildAuthorProfileSummaryParts(
        profile,
        this.readStringArrayFromObject(plain, ['affiliations']),
      ),
      institution:
        institutionId || institutionCanonicalKey || university
          ? {
              id: institutionId,
              name: university,
              canonicalKey: institutionCanonicalKey,
              aliases: institutionAliases,
            }
          : undefined,
      platformIds,
      platformIdsRaw,
    };
  }

  private formatPublicationOutput(publication: unknown) {
    const plain = this.toPlainObject(publication);
    const sourceRecords = Array.isArray(plain.sourceRecords)
      ? (plain.sourceRecords as Array<Record<string, unknown>>)
      : [];
    const authorIds = Array.isArray(plain.authorIds)
      ? plain.authorIds
          .map((item) => this.toObjectIdString(item))
          .filter((item): item is string => Boolean(item))
      : [];

    return {
      ...plain,
      authorIds,
      sourceRecords: sourceRecords.map((item) =>
        this.formatSourceRecordOutput(item),
      ),
    };
  }

  private formatSourceProfileOutput(sourceProfile: Record<string, unknown>) {
    const platform =
      this.readStringFromObject(sourceProfile, ['platform']) ?? undefined;
    const platformLabel = this.getPlatformDisplayName(platform);

    return {
      ...sourceProfile,
      platform: platformLabel,
      platformKey: platform,
      platformLabel,
    };
  }

  private formatSourceRecordOutput(sourceRecord: Record<string, unknown>) {
    const platform =
      this.readStringFromObject(sourceRecord, ['platform']) ?? undefined;
    const platformLabel = this.getPlatformDisplayName(platform);

    return {
      ...sourceRecord,
      platform: platformLabel,
      platformKey: platform,
      platformLabel,
    };
  }

  private getPlatformDisplayName(platform?: string | null) {
    const normalized = platform?.trim().toLowerCase();
    if (normalized === 'clarivate_wos') {
      return 'Web Of Science';
    }
    if (normalized === 'openalex') {
      return 'OpenAlex';
    }
    return platform ?? '';
  }

  private buildAuthorProfile(
    plain: Record<string, unknown>,
    parsedAffiliations: Array<Record<string, unknown>>,
  ) {
    const institutionName = this.pickAuthorInstitutionDisplayName(
      plain,
      parsedAffiliations,
    );
    const scopedAffiliations = this.filterParsedAffiliationsForInstitution(
      parsedAffiliations,
      institutionName,
    );
    const personTitle = this.pickPreferredProfileValue(
      scopedAffiliations.map((item) =>
        this.readStringFromObject(item, ['personTitle']),
      ),
    );
    const role = this.pickPreferredProfileValue(
      scopedAffiliations.map((item) => this.readStringFromObject(item, ['role'])),
    );
    const faculty = this.pickPreferredProfileValue([
      ...scopedAffiliations.map((item) =>
        this.readStringFromObject(item, ['faculty']),
      ),
    ]);
    const department = this.pickPreferredProfileValue([
      ...scopedAffiliations.map((item) =>
        this.readStringFromObject(item, ['department']),
      ),
    ]);
    const city = this.pickPreferredProfileValue([
      ...scopedAffiliations.map((item) => this.readStringFromObject(item, ['city'])),
      this.readStringFromObject(plain, ['city']),
      ...parsedAffiliations.map((item) => this.readStringFromObject(item, ['city'])),
    ]);
    const country = this.pickPreferredProfileValue([
      ...scopedAffiliations.map((item) =>
        this.readStringFromObject(item, ['country']),
      ),
      this.readStringFromObject(plain, ['country']),
      ...parsedAffiliations.map((item) =>
        this.readStringFromObject(item, ['country']),
      ),
    ]);
    const explicitEmail = this.pickPreferredProfileValue(
      scopedAffiliations
        .map((item) => this.readStringFromObject(item, ['email']))
        .filter((item) => Boolean(item?.includes?.('@'))),
    );
    const emailDomain = this.pickPreferredProfileValue([
      this.readStringFromObject(plain, ['emailDomain']),
      ...scopedAffiliations.map((item) =>
        this.readStringFromObject(item, ['emailDomain']),
      ),
      ...parsedAffiliations.map((item) =>
        this.readStringFromObject(item, ['emailDomain']),
      ),
    ]);

    return {
      institutionName,
      title: this.joinProfileValues([personTitle, role], ', '),
      email: explicitEmail,
      emailDomain,
      faculty,
      country,
      city,
      department,
    };
  }

  private buildAuthorProfileSummaryParts(
    profile: {
      institutionName?: string;
      title?: string;
      email?: string;
      emailDomain?: string;
      faculty?: string;
      country?: string;
      city?: string;
      department?: string;
    },
    affiliations: string[],
  ) {
    const result: string[] = [];

    this.pushUniqueProfilePart(result, profile.institutionName);
    this.pushUniqueProfilePart(result, profile.title);
    this.pushUniqueProfilePart(
      result,
      profile.email
        ? `Email: ${profile.email}`
        : profile.emailDomain
          ? `Verified email: ${profile.emailDomain}`
          : undefined,
    );
    this.pushUniqueProfilePart(result, profile.faculty);
    this.pushUniqueProfilePart(result, profile.country);
    this.pushUniqueProfilePart(result, profile.city);
    this.pushUniqueProfilePart(result, profile.department);

    if (result.length === 0) {
      for (const affiliation of affiliations) {
        this.pushUniqueProfilePart(result, affiliation);
      }
    }

    return result;
  }

  private pushUniqueProfilePart(result: string[], value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }

    const normalized = this.normalizeText(trimmed);
    if (!normalized) {
      return;
    }

    const exists = result.some((item) => {
      const current = this.normalizeText(item);
      return current === normalized;
    });

    if (!exists) {
      result.push(trimmed);
    }
  }

  private pickPreferredProfileValue(values: Array<string | null | undefined>) {
    const unique = values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .filter((value, index, array) => {
        const key = this.normalizeText(value);
        return array.findIndex((item) => this.normalizeText(item) === key) === index;
      });

    if (unique.length === 0) {
      return undefined;
    }

    return [...unique].sort((left, right) => {
      const scoreDiff =
        this.profileValueScore(right) - this.profileValueScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return right.length - left.length;
    })[0];
  }

  private profileValueScore(value: string) {
    let score = value.length;

    if (value.includes('@')) {
      score += 20;
    }
    if (/\b(university|universit|faculty|department|institute|hospital)\b/i.test(value)) {
      score += 8;
    }

    score -= (value.match(/,/g) ?? []).length * 6;
    return score;
  }

  private joinProfileValues(
    values: Array<string | null | undefined>,
    separator: string,
  ) {
    const unique = values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .filter((value, index, array) => {
        const key = this.normalizeText(value);
        return array.findIndex((item) => this.normalizeText(item) === key) === index;
      });

    return unique.length > 0 ? unique.join(separator) : undefined;
  }

  private formatInstitutionOutput(institution: unknown) {
    const plain = this.toPlainObject(institution);
    return {
      ...plain,
      id: this.readStringFromObject(plain, ['_id']) ?? undefined,
      manualAliases: this.readStringArrayFromObject(plain, ['manualAliases']),
      aliases: this.readStringArrayFromObject(plain, ['aliases']),
      canonicalLocked:
        typeof plain.canonicalLocked === 'boolean'
          ? plain.canonicalLocked
          : false,
    };
  }

  private toPlainObject(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value === 'object' && value !== null) {
      const maybeDoc = value as { toObject?: () => Record<string, unknown> };
      if (typeof maybeDoc.toObject === 'function') {
        return maybeDoc.toObject();
      }
      return value as Record<string, unknown>;
    }

    return {};
  }
}
