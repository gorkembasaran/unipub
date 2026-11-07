import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ClarivateService } from './clarivate.service';

@Controller('clarivate/wos-starter')
export class ClarivateController {
  constructor(private readonly clarivateService: ClarivateService) {}

  @Get('documents')
  searchDocuments(
    @Query('q') q?: string,
    @Query('db') db?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('sortField') sortField?: string,
    @Query('modifiedTimeSpan') modifiedTimeSpan?: string,
    @Query('publishTimeSpan') publishTimeSpan?: string,
    @Query('tcModifiedTimeSpan') tcModifiedTimeSpan?: string,
    @Query('detail') detail?: string,
    @Query('edition') edition?: string,
    @Query('apiVersion') apiVersion?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` zorunlu. Ornek: /clarivate/wos-starter/documents?q=AU%3D(%22Yilmaz%20Kemal%20Yuce%22)',
      );
    }

    return this.clarivateService.searchDocuments({
      q: q.trim(),
      db: db?.trim() || undefined,
      limit: this.parseLimit(limit, 10),
      page: this.parsePage(page),
      sortField: sortField?.trim() || undefined,
      modifiedTimeSpan: modifiedTimeSpan?.trim() || undefined,
      publishTimeSpan: publishTimeSpan?.trim() || undefined,
      tcModifiedTimeSpan: tcModifiedTimeSpan?.trim() || undefined,
      detail: detail?.trim() || undefined,
      edition: edition?.trim() || undefined,
      apiVersion: this.parseApiVersion(apiVersion),
    });
  }

  @Get('authors')
  searchAuthors(
    @Query('q') q?: string,
    @Query('db') db?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('detail') detail?: string,
    @Query('sortField') sortField?: string,
    @Query('apiVersion') apiVersion?: string,
    @Query('includeCandidates') includeCandidates?: string,
    @Query('includeHits') includeHits?: string,
    @Query('includeRaw') includeRaw?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` zorunlu. Ornek: /clarivate/wos-starter/authors?q=Yilmaz%20Kemal%20Yuce',
      );
    }

    return this.clarivateService.searchAuthors({
      q: q.trim(),
      db: db?.trim() || undefined,
      limit: this.parseLimit(limit, 10),
      page: this.parsePage(page),
      detail: detail?.trim() || undefined,
      sortField: sortField?.trim() || undefined,
      apiVersion: this.parseApiVersion(apiVersion),
      includeCandidates: this.parseBoolean(includeCandidates),
      includeHits: this.parseBoolean(includeHits),
      includeRaw: this.parseBoolean(includeRaw),
    });
  }

  private parseLimit(value?: string, fallback = 10) {
    if (!value?.trim()) {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      throw new BadRequestException(
        '`limit` 1 ile 50 arasinda tam sayi olmali.',
      );
    }

    return parsed;
  }

  private parsePage(value?: string) {
    if (!value?.trim()) {
      return 1;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(
        '`page` 1 veya daha buyuk tam sayi olmali.',
      );
    }

    return parsed;
  }

  private parseApiVersion(value?: string) {
    if (!value?.trim()) {
      return 'v2' as const;
    }

    if (value === 'v1' || value === 'v2') {
      return value;
    }

    throw new BadRequestException(
      '`apiVersion` sadece `v1` veya `v2` olabilir.',
    );
  }

  private parseBoolean(value?: string) {
    if (!value?.trim()) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no'].includes(normalized)) {
      return false;
    }

    throw new BadRequestException(
      'Boolean parametreler true veya false olmali.',
    );
  }
}
