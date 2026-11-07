import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogService } from '../catalog/catalog.service';
import { normalizePersonName } from '../common/normalize-person-name';
import { OpenalexService } from '../openalex/openalex.service';

// Loads a list of researchers (by OpenAlex author id) and their works into the
// catalog. Used to seed the public demo with open (CC0) data:
//   npm run seed:openalex -- --file=seeds/alku-ce.json [--works-limit=200] [--dry-run]

type SeedFile = {
  institution: {
    name: string;
    openalexId?: string;
    city?: string;
    country?: string;
  };
  authors: Array<{ name: string; openalexIds: string[] }>;
};

type ScriptOptions = {
  file: string;
  worksLimit: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): ScriptOptions {
  let file = 'seeds/alku-ce.json';
  let worksLimit = 200;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length).trim() || file;
      continue;
    }

    if (arg.startsWith('--works-limit=')) {
      const parsed = Number(arg.slice('--works-limit='.length));
      if (Number.isInteger(parsed) && parsed > 0) {
        worksLimit = Math.min(parsed, 1000);
      }
    }
  }

  return { file, worksLimit, dryRun };
}

async function bootstrap() {
  const options = parseArgs(process.argv.slice(2));
  const seed = JSON.parse(
    readFileSync(resolve(process.cwd(), options.file), 'utf8'),
  ) as SeedFile;
  const openalexService = new OpenalexService();

  const app = options.dryRun
    ? null
    : await NestFactory.createApplicationContext(AppModule, {
        logger: ['warn', 'error'],
      });
  const catalogService = app?.get(CatalogService);
  const summary: Array<Record<string, unknown>> = [];

  try {
    for (const entry of seed.authors) {
      const works = new Map<
        string,
        Awaited<ReturnType<OpenalexService['getAuthorWorks']>>['works'][number]
      >();
      for (const openalexId of entry.openalexIds) {
        const result = await openalexService.getAuthorWorks(openalexId, {
          limit: options.worksLimit,
        });
        for (const work of result.works) {
          works.set(work.externalId, work);
        }
      }

      if (!catalogService) {
        summary.push({ name: entry.name, works: works.size });
        continue;
      }

      const { authorId } = await catalogService.upsertDiscoveredAuthor({
        displayName: entry.name,
        normalizedName: normalizePersonName(entry.name),
        affiliationRaw: [seed.institution.name],
        university: seed.institution.name,
        city: seed.institution.city,
        country: seed.institution.country,
        sourceProfiles: entry.openalexIds.map((id) => ({
          platform: 'openalex',
          externalAuthorId: id,
          profileUrl: `https://openalex.org/${id}`,
        })),
      });

      let saved = 0;
      let failed = 0;
      for (const work of works.values()) {
        if (!work.title) {
          continue;
        }
        try {
          await catalogService.upsertPublication({
            title: work.title,
            doi: work.doi ?? undefined,
            journal: work.journal ?? undefined,
            publishedYear: work.publishedYear ?? undefined,
            authors: work.authors,
            citationCount: work.citedByCount,
            authorIds: [authorId],
            sourceRecords: [
              {
                platform: 'openalex',
                sourceId: work.externalId,
                sourceUrl: work.url ?? undefined,
              },
            ],
          });
          saved += 1;
        } catch (error: unknown) {
          // e.g. two OpenAlex works sharing a title/year/journal fingerprint
          failed += 1;
          console.warn(
            `skipped "${work.title}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      summary.push({ name: entry.name, authorId, works: works.size, saved, failed });
    }

    console.log(JSON.stringify({ dryRun: options.dryRun, authors: summary }, null, 2));
  } finally {
    await app?.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
