import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogService } from '../catalog/catalog.service';

type ScriptOptions = {
  limit: number;
  dryRun: boolean;
  reset: boolean;
  query?: string;
};

function parseArgs(argv: string[]): ScriptOptions {
  let limit = 1000;
  let dryRun = false;
  let reset = false;
  let query: string | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--reset') {
      reset = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (Number.isInteger(parsed) && parsed > 0) {
        limit = Math.min(parsed, 10000);
      }
      continue;
    }

    if (arg.startsWith('--query=')) {
      const trimmed = arg.slice('--query='.length).trim();
      query = trimmed || undefined;
    }
  }

  return { limit, dryRun, reset, query };
}

async function bootstrap() {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const catalogService = app.get(CatalogService);
    const reset =
      options.reset && !options.dryRun
        ? await catalogService.resetInstitutions()
        : null;
    const backfill = await catalogService.backfillInstitutions({
      limit: options.limit,
      dryRun: options.dryRun,
    });
    const seeds = await catalogService.listInstitutionFilterSeeds();
    const query = options.query?.toLocaleLowerCase('tr-TR');
    const institutions = query
      ? seeds.filter((item) =>
          [
            typeof item.canonicalName === 'string' ? item.canonicalName : '',
            ...((Array.isArray(item.aliases) ? item.aliases : []) as string[]),
          ]
            .filter((value): value is string => typeof value === 'string')
            .some((value) => value.toLocaleLowerCase('tr-TR').includes(query)),
        )
      : seeds;

    console.log(
      JSON.stringify(
        {
          reset,
          backfill,
          institutions,
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
