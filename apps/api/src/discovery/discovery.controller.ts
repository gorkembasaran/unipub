import {
  BadRequestException,
  Body,
  Controller,
  Get,
  UnauthorizedException,
  Param,
  Post,
  Query,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiscoveryService } from './discovery.service';

@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly authService: AuthService,
  ) {}

  @Get('authors/filters')
  getAuthorFilters(
    @Query('country') country?: string,
    @Query('city') city?: string,
    @Query('school') school?: string,
    @Query('institution') institution?: string,
    @Query('university') university?: string,
  ) {
    return this.discoveryService.getAuthorFilters({
      country: country?.trim(),
      city: city?.trim(),
      school: school?.trim(),
      institution: institution?.trim(),
      university: university?.trim(),
    });
  }

  @Get('authors')
  discoverAuthors(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
    @Query('city') city?: string,
    @Query('school') school?: string,
    @Query('institution') institution?: string,
    @Query('university') university?: string,
  ) {
    if (!q?.trim()) {
      throw new BadRequestException(
        '`q` zorunlu. Ornek: /discovery/authors?q=Yilmaz%20Kemal%20Yuce',
      );
    }

    const parsedLimit = limit ? Number(limit) : 10;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : 10;

    return this.discoveryService.discoverAuthors(q.trim(), safeLimit, {
      country: country?.trim(),
      city: city?.trim(),
      school: school?.trim(),
      institution: institution?.trim(),
      university: university?.trim(),
    });
  }

  @Get('authors/:id')
  getAuthor(@Param('id') id: string) {
    return this.discoveryService.getAuthorById(id);
  }

  @Post('authors/:id/refresh-request')
  @UseGuards(JwtAuthGuard)
  async requestAuthorRefresh(
    @Param('id') id: string,
    @Body()
    body?: {
      authorName?: string;
      context?: string;
      profilePath?: string;
    },
  ) {
    const author = await this.discoveryService.getAuthorById(id);
    const authorName = this.readAuthorName(author);

    return {
      requested: true,
      requestId: `refresh-${id}-${Date.now()}`,
      status: 'pending',
      authorId: id,
      authorName: authorName || body?.authorName?.trim() || id,
      context: body?.context?.trim() || 'author_detail',
      profilePath: body?.profilePath?.trim() || undefined,
      message: 'Veri yenileme istegi alindi.',
    };
  }

  @Post('authors/:id/publications/sync')
  syncAuthorPublications(
    @Param('id') id: string,
    @Query('limitPerSource') limitPerSource?: string,
    @Query('force') force?: string,
    @Query('publishedFrom') publishedFrom?: string,
    @Query('publishedTo') publishedTo?: string,
    @Query('years') years?: string,
    @Query('yearWindow') yearWindow?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const parsedLimit = limitPerSource ? Number(limitPerSource) : 25;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 25;
    const forceRefresh =
      typeof force === 'string' &&
      ['1', 'true', 'yes', 'on'].includes(force.trim().toLowerCase());

    if (forceRefresh) {
      const token = this.extractBearerToken(authorization);
      this.authService.verifyAccessToken(token);
    }

    const dateRange = this.resolveDateRangeQuery({
      publishedFrom,
      publishedTo,
      years,
      yearWindow,
    });

    return this.discoveryService.syncAuthorPublications(id, safeLimit, {
      force: forceRefresh,
      ...dateRange,
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

    return this.discoveryService.listPublications({
      authorId,
      query: q,
      ...dateRange,
    });
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Force yenileme icin Authorization Bearer token gerekli.',
      );
    }

    const token = authorization.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException(
        'Force yenileme icin Authorization Bearer token gerekli.',
      );
    }

    return token;
  }

  private readAuthorName(author: unknown) {
    if (!author || typeof author !== 'object') {
      return undefined;
    }

    const candidate = author as Record<string, unknown>;
    const fullName =
      typeof candidate.fullName === 'string' ? candidate.fullName.trim() : '';
    if (fullName) {
      return fullName;
    }

    const displayName =
      typeof candidate.displayName === 'string'
        ? candidate.displayName.trim()
        : '';
    return displayName || undefined;
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

  private parseYearWindowQuery(years?: string, yearWindow?: string) {
    const raw = years?.trim() || yearWindow?.trim();
    if (!raw) {
      return undefined;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `Gecersiz yil araligi: "${raw}". Pozitif tam sayi kullanin.`,
      );
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
}
