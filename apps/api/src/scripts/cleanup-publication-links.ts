import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { arePersonNamesCompatible } from '../common/person-name-match';
import { normalizePersonName } from '../common/normalize-person-name';
import { PublicationSyncService } from '../catalog/publication-sync.service';
import { Author } from '../catalog/schemas/author.schema';
import { Publication } from '../catalog/schemas/publication.schema';

type PlainObject = Record<string, unknown>;

type ScriptOptions = {
  limit: number;
  dryRun: boolean;
  deleteOrphans: boolean;
  resync: boolean;
  authorId?: string;
  query?: string;
  platforms?: string[];
};

type LeanAuthor = {
  _id: Types.ObjectId;
  fullName: string;
  aliases?: string[];
};

type LeanPublication = {
  _id: Types.ObjectId;
  title: string;
  publishedAt?: Date | string;
  publishedYear?: number;
  authors?: string[];
  authorsText?: string;
  authorIds?: Types.ObjectId[];
  sourceRecords?: Array<{
    platform?: string;
    metadata?: Record<string, unknown>;
  }>;
};

function parseArgs(argv: string[]): ScriptOptions {
  let limit = 1000;
  let dryRun = false;
  let deleteOrphans = false;
  let resync = false;
  let authorId: string | undefined;
  let query: string | undefined;
  let platforms: string[] | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--delete-orphans') {
      deleteOrphans = true;
      continue;
    }

    if (arg === '--resync') {
      resync = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isInteger(parsed) && parsed > 0) {
        limit = Math.min(parsed, 10000);
      }
      continue;
    }

    if (arg.startsWith('--author-id=')) {
      const trimmed = arg.slice('--author-id='.length).trim();
      authorId = trimmed || undefined;
      continue;
    }

    if (arg.startsWith('--query=')) {
      const trimmed = arg.slice('--query='.length).trim();
      query = trimmed || undefined;
      continue;
    }

    if (arg.startsWith('--platform=')) {
      const raw = arg.slice('--platform='.length);
      const resolved = raw
        .split(',')
        .map((value) => normalizePlatform(value))
        .filter((value): value is string => Boolean(value));
      platforms = resolved.length > 0 ? [...new Set(resolved)] : undefined;
    }
  }

  return {
    limit,
    dryRun,
    deleteOrphans,
    resync,
    authorId,
    query,
    platforms,
  };
}

function normalizePlatform(value?: string | null) {
  const normalized = value?.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'pubmed') return 'scraper_pubmed';
  if (normalized === 'trdizin' || normalized === 'tr-dizin') return 'trdizin';
  if (normalized === 'scholar' || normalized === 'google-scholar')
    return 'serpapi_scholar';
  if (normalized === 'scopus') return 'scraper_scopus';

  return normalized;
}

function splitAuthorText(value?: string | null) {
  const raw = value?.trim();
  if (!raw) {
    return [] as string[];
  }

  return raw
    .split(/\s*(?:;|,|\band\b)\s*/i)
    .map((item) => item.trim().replace(/[.;]+$/g, ''))
    .filter(Boolean);
}

function collectPublicationAuthorCandidates(publication: LeanPublication) {
  const names = new Set<string>();

  for (const item of publication.authors ?? []) {
    if (typeof item === 'string' && item.trim()) {
      names.add(item.trim());
    }
  }

  for (const item of splitAuthorText(publication.authorsText)) {
    names.add(item);
  }

  for (const sourceRecord of publication.sourceRecords ?? []) {
    const metadata = sourceRecord?.metadata;
    if (!metadata || typeof metadata !== 'object') {
      continue;
    }

    const rawPublication =
      metadata.rawPublication && typeof metadata.rawPublication === 'object'
        ? (metadata.rawPublication as PlainObject)
        : null;
    const matchedAuthor =
      metadata.matchedAuthor && typeof metadata.matchedAuthor === 'object'
        ? (metadata.matchedAuthor as PlainObject)
        : null;

    if (rawPublication) {
      for (const item of splitAuthorText(
        typeof rawPublication.authors === 'string' ? rawPublication.authors : undefined,
      )) {
        names.add(item);
      }

      const detail =
        rawPublication.detail && typeof rawPublication.detail === 'object'
          ? (rawPublication.detail as PlainObject)
          : null;
      if (detail && Array.isArray(detail.fullAuthors)) {
        for (const item of detail.fullAuthors) {
          if (typeof item === 'string' && item.trim()) {
            names.add(item.trim());
          }
        }
      }
    }

    if (matchedAuthor) {
      const matchedName =
        (typeof matchedAuthor.inPublicationName === 'string' &&
          matchedAuthor.inPublicationName.trim()) ||
        (typeof matchedAuthor.name === 'string' && matchedAuthor.name.trim()) ||
        (typeof matchedAuthor.fullName === 'string' && matchedAuthor.fullName.trim()) ||
        null;
      if (matchedName) {
        names.add(matchedName);
      }
    }
  }

  return Array.from(names);
}

function shouldKeepAuthorLink(author: LeanAuthor, candidateNames: string[]) {
  if (candidateNames.length === 0) {
    return true;
  }

  const authorNames = [
    author.fullName,
    ...(Array.isArray(author.aliases) ? author.aliases : []),
  ].filter((value): value is string => Boolean(value?.trim()));

  return authorNames.some((authorName) =>
    candidateNames.some((candidateName) =>
      arePersonNamesCompatible(authorName, candidateName, {
        allowInitialSuffixMatch: true,
      }),
    ),
  );
}

function sanitizePublicationDates(publication: LeanPublication) {
  const currentYear = new Date().getUTCFullYear() + 1;
  const update: {
    clearPublishedAt: boolean;
    clearPublishedYear: boolean;
  } = {
    clearPublishedAt: false,
    clearPublishedYear: false,
  };

  if (typeof publication.publishedYear === 'number') {
    if (publication.publishedYear < 1000 || publication.publishedYear > currentYear) {
      update.clearPublishedYear = true;
    }
  }

  if (publication.publishedAt) {
    const parsed = new Date(publication.publishedAt);
    const year = parsed.getUTCFullYear();

    if (
      Number.isNaN(parsed.getTime()) ||
      year < 1000 ||
      year > currentYear ||
      (typeof publication.publishedYear === 'number' &&
        !update.clearPublishedYear &&
        publication.publishedYear > 0 &&
        year !== publication.publishedYear)
    ) {
      update.clearPublishedAt = true;
    }
  }

  return update;
}

async function resolveAuthorIds(
  authorModel: Model<Author>,
  options: ScriptOptions,
) {
  if (options.authorId) {
    if (!Types.ObjectId.isValid(options.authorId)) {
      throw new Error(`Geçersiz author id: ${options.authorId}`);
    }
    return [new Types.ObjectId(options.authorId)];
  }

  if (!options.query?.trim()) {
    return [] as Types.ObjectId[];
  }

  const normalized = normalizePersonName(options.query);
  const regex = new RegExp(options.query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const normalizedRegex = new RegExp(
    normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i',
  );
  const authors = await authorModel
    .find({
      $or: [
        { fullName: regex },
        { normalizedName: normalizedRegex },
        { aliases: regex },
      ],
    })
    .limit(Math.max(options.limit, 100))
    .lean()
    .exec();

  return authors.map((item) => item._id as Types.ObjectId);
}

async function bootstrap() {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const authorModel = app.get<Model<Author>>(getModelToken(Author.name));
    const publicationModel = app.get<Model<Publication>>(
      getModelToken(Publication.name),
    );
    const publicationSyncService = app.get(PublicationSyncService);

    const scopedAuthorIds = await resolveAuthorIds(authorModel, options);
    const filter: Record<string, unknown> = {
      'authorIds.0': { $exists: true },
    };

    if (scopedAuthorIds.length > 0) {
      filter.authorIds = { $in: scopedAuthorIds };
    }

    if (options.platforms && options.platforms.length > 0) {
      filter.sourceRecords = {
        $elemMatch: {
          platform: { $in: options.platforms },
        },
      };
    }

    const publications = (await publicationModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(options.limit)
      .lean()
      .exec()) as unknown as LeanPublication[];

    const authorIds = new Set<string>();
    for (const publication of publications) {
      for (const authorId of publication.authorIds ?? []) {
        authorIds.add(String(authorId));
      }
    }

    const authors = (await authorModel
      .find({
        _id: { $in: Array.from(authorIds).map((id) => new Types.ObjectId(id)) },
      })
      .lean()
      .exec()) as unknown as LeanAuthor[];
    const authorMap = new Map(authors.map((item) => [String(item._id), item]));

    const touchedAuthorIds = new Set<string>();
    const samples: Array<Record<string, unknown>> = [];
    let updatedPublications = 0;
    let deletedPublications = 0;
    let removedAuthorLinks = 0;
    let clearedPublishedAt = 0;
    let clearedPublishedYear = 0;
    let skippedWithoutAuthorNames = 0;

    for (const publication of publications) {
      const candidateNames = collectPublicationAuthorCandidates(publication);
      if (candidateNames.length === 0) {
        skippedWithoutAuthorNames += 1;
      }

      const currentAuthorIds = (publication.authorIds ?? []).map((item) => String(item));
      const removedFromPublication: string[] = [];
      const nextAuthorIds = currentAuthorIds.filter((authorId) => {
        const author = authorMap.get(authorId);
        if (!author) {
          removedFromPublication.push(authorId);
          return false;
        }

        const keep = shouldKeepAuthorLink(author, candidateNames);
        if (!keep) {
          removedFromPublication.push(author.fullName);
          touchedAuthorIds.add(authorId);
        }
        return keep;
      });

      const dateCleanup = sanitizePublicationDates(publication);
      const hasAuthorChange = nextAuthorIds.length !== currentAuthorIds.length;
      const hasDateChange =
        dateCleanup.clearPublishedAt || dateCleanup.clearPublishedYear;

      if (!hasAuthorChange && !hasDateChange) {
        continue;
      }

      updatedPublications += 1;
      removedAuthorLinks += Math.max(currentAuthorIds.length - nextAuthorIds.length, 0);
      if (dateCleanup.clearPublishedAt) {
        clearedPublishedAt += 1;
      }
      if (dateCleanup.clearPublishedYear) {
        clearedPublishedYear += 1;
      }

      if (samples.length < 40) {
        samples.push({
          publicationId: String(publication._id),
          title: publication.title,
          removedAuthors: removedFromPublication,
          remainingAuthorIds: nextAuthorIds,
          clearedPublishedAt: dateCleanup.clearPublishedAt,
          clearedPublishedYear: dateCleanup.clearPublishedYear,
        });
      }

      if (options.dryRun) {
        continue;
      }

      if (options.deleteOrphans && nextAuthorIds.length === 0) {
        await publicationModel.deleteOne({ _id: publication._id }).exec();
        deletedPublications += 1;
        continue;
      }

      const setPayload: Record<string, unknown> = {
        authorIds: nextAuthorIds.map((id) => new Types.ObjectId(id)),
      };
      const unsetPayload: Record<string, 1> = {};

      if (dateCleanup.clearPublishedAt) {
        unsetPayload.publishedAt = 1;
      }
      if (dateCleanup.clearPublishedYear) {
        unsetPayload.publishedYear = 1;
      }

      await publicationModel
        .updateOne(
          { _id: publication._id },
          Object.keys(unsetPayload).length > 0
            ? { $set: setPayload, $unset: unsetPayload }
            : { $set: setPayload },
        )
        .exec();
    }

    const resyncedAuthors: Array<Record<string, unknown>> = [];
    if (options.resync && !options.dryRun) {
      for (const authorId of touchedAuthorIds) {
        const result = await publicationSyncService.syncAuthorPublications(authorId, 25, {
          force: true,
        });
        resyncedAuthors.push({
          authorId,
          authorName: result.authorName,
          totalMerged: result.totalMerged,
          totalUpserted: result.totalUpserted,
          catalogCount: result.catalogCount,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          options,
          scannedPublications: publications.length,
          scopedAuthorIds: scopedAuthorIds.map((item) => String(item)),
          updatedPublications,
          deletedPublications,
          removedAuthorLinks,
          clearedPublishedAt,
          clearedPublishedYear,
          skippedWithoutAuthorNames,
          resyncedAuthors,
          samples,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
