import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PublicationSyncService } from './publication-sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly publicationSyncService: PublicationSyncService,
  ) {}

  @Get('stats')
  getStats() {
    return this.catalogService.getCatalogStats();
  }

  @Get('authors')
  listAuthors(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 50;
    const safeLimit = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 200)
      : 50;
    return this.catalogService.listAuthors(safeLimit);
  }

  @Post('authors')
  @UseGuards(JwtAuthGuard)
  createAuthor(
    @Body()
    body: {
      fullName?: string;
      aliases?: string[];
      affiliations?: string[];
      orcid?: string;
    },
  ) {
    if (!body.fullName?.trim()) {
      throw new BadRequestException('`fullName` zorunlu.');
    }

    return this.catalogService.createAuthor({
      fullName: body.fullName,
      aliases: body.aliases,
      affiliations: body.affiliations,
      orcid: body.orcid,
    });
  }

  @Get('authors/:id')
  getAuthor(@Param('id') id: string) {
    return this.catalogService.getAuthorById(id);
  }

  @Post('authors/:id/sync-publications')
  @UseGuards(JwtAuthGuard)
  syncAuthorPublications(
    @Param('id') id: string,
    @Query('limitPerSource') limitPerSource?: string,
    @Query('force') force?: string,
    @Query('publishedFrom') publishedFrom?: string,
    @Query('publishedTo') publishedTo?: string,
    @Query('years') years?: string,
    @Query('yearWindow') yearWindow?: string,
  ) {
    const parsedLimit = limitPerSource ? Number(limitPerSource) : 25;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 25;
    const forceRefresh =
      typeof force === 'string' &&
      ['1', 'true', 'yes', 'on'].includes(force.trim().toLowerCase());
    const dateRange = this.resolveDateRangeQuery({
      publishedFrom,
      publishedTo,
      years,
      yearWindow,
    });

    return this.publicationSyncService.syncAuthorPublications(id, safeLimit, {
      force: forceRefresh,
      ...dateRange,
    });
  }

  @Get('authors/by-platform')
  getAuthorByPlatform(
    @Query('platform') platform?: string,
    @Query('externalAuthorId') externalAuthorId?: string,
  ) {
    if (!platform?.trim() || !externalAuthorId?.trim()) {
      throw new BadRequestException(
        '`platform` ve `externalAuthorId` zorunlu. Ornek: /catalog/authors/by-platform?platform=serpapi_scholar&externalAuthorId=K3LR8mUAAAAJ',
      );
    }

    return this.catalogService.getAuthorByPlatformId(
      platform.trim(),
      externalAuthorId.trim(),
    );
  }

  @Get('institutions')
  listInstitutions(@Query('q') q?: string) {
    return this.catalogService.listInstitutions(q);
  }

  @Post('institutions/aliases')
  @UseGuards(JwtAuthGuard)
  upsertInstitutionAlias(
    @Body()
    body: {
      canonicalName?: string;
      aliases?: string[];
      canonicalLocked?: boolean;
      city?: string;
      country?: string;
    },
  ) {
    if (!body.canonicalName?.trim()) {
      throw new BadRequestException('`canonicalName` zorunlu.');
    }

    return this.catalogService.upsertInstitutionAliasOverride({
      canonicalName: body.canonicalName.trim(),
      aliases: body.aliases,
      canonicalLocked: body.canonicalLocked,
      city: body.city?.trim() || undefined,
      country: body.country?.trim() || undefined,
    });
  }

  @Post('institutions/backfill')
  @UseGuards(JwtAuthGuard)
  backfillInstitutions(
    @Query('limit') limit?: string,
    @Query('dryRun') dryRun?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 1000;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 10000)
      : 1000;
    const isDryRun =
      typeof dryRun === 'string' &&
      ['1', 'true', 'yes', 'on'].includes(dryRun.trim().toLowerCase());

    return this.catalogService.backfillInstitutions({
      limit: safeLimit,
      dryRun: isDryRun,
    });
  }

  @Post('publications')
  @UseGuards(JwtAuthGuard)
  upsertPublication(
    @Body()
    body: {
      title?: string;
      doi?: string;
      journal?: string;
      publishedAt?: string;
      publishedYear?: number;
      authorIds?: string[];
      sourceRecords?: Array<{
        platform: string;
        sourceId?: string;
        sourceUrl?: string;
      }>;
    },
  ) {
    if (!body.title?.trim()) {
      throw new BadRequestException('`title` zorunlu.');
    }

    return this.catalogService.upsertPublication({
      title: body.title,
      doi: body.doi,
      journal: body.journal,
      publishedAt: body.publishedAt,
      publishedYear: body.publishedYear,
      authorIds: body.authorIds,
      sourceRecords: body.sourceRecords,
    });
  }

  @Get('publications')
  listPublications(
    @Query('authorId') authorId?: string,
    @Query('q') q?: string,
    @Query('publishedFrom') publishedFrom?: string,
    @Query('publishedTo') publishedTo?: string,
    @Query('years') years?: string,
    @Query('yearWindow') yearWindow?: string,
  ) {
    const dateRange = this.resolveDateRangeQuery({
      publishedFrom,
      publishedTo,
      years,
      yearWindow,
    });

    return this.catalogService.listPublications({
      authorId,
      query: q,
      ...dateRange,
    });
  }

  @Get('publications/:id')
  getPublication(@Param('id') id: string) {
    return this.catalogService.getPublicationById(id);
  }

  private parseDateQuery(value?: string, endOfDay = false) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Gecersiz tarih parametresi: "${value}". ISO format kullanin (ornek: 2026-01-31).`,
      );
    }

    if (endOfDay) {
      parsed.setUTCHours(23, 59, 59, 999);
    } else {
      parsed.setUTCHours(0, 0, 0, 0);
    }

    return parsed;
  }

  private resolveDateRangeQuery(input: {
    publishedFrom?: string;
    publishedTo?: string;
    years?: string;
    yearWindow?: string;
  }) {
    const publishedFrom = this.parseDateQuery(input.publishedFrom, false);
    const publishedTo = this.parseDateQuery(input.publishedTo, true);

    if (publishedFrom || publishedTo) {
      return { publishedFrom, publishedTo };
    }

    const yearWindow = this.parseYearWindowQuery(input.years, input.yearWindow);
    if (!yearWindow) {
      return {};
    }

    const cutoffDate = new Date();
    cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear() - yearWindow);

    return {
      publishedFrom: cutoffDate,
    };
  }

  private parseYearWindowQuery(years?: string, yearWindow?: string) {
    const rawValue = years?.trim() || yearWindow?.trim();
    if (!rawValue) {
      return undefined;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `Gecersiz year window parametresi: "${rawValue}". Pozitif tam sayi kullanin.`,
      );
    }

    return parsed;
  }
}
