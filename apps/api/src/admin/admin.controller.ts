import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('authors')
  searchAuthors(@Query('q') q?: string, @Query('limit') limit?: string) {
    if (!q?.trim()) {
      throw new BadRequestException('`q` zorunlu.');
    }

    const parsedLimit = limit ? Number(limit) : 20;
    const safeLimit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    return this.adminService.searchAuthors(q.trim(), safeLimit);
  }

  @Get('authors/:id')
  getAuthor(@Param('id') id: string) {
    return this.adminService.getAuthor(id);
  }

  @Get('authors/:id/publications')
  listAuthorPublications(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('publishedFrom') publishedFrom?: string,
    @Query('publishedTo') publishedTo?: string,
  ) {
    return this.adminService.listAuthorPublications({
      authorId: id,
      query: q?.trim() || undefined,
      publishedFrom: this.parseDateQuery(publishedFrom, false),
      publishedTo: this.parseDateQuery(publishedTo, true),
    });
  }

  @Patch('authors/:id')
  updateAuthor(
    @Param('id') id: string,
    @Body()
    body: {
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
      sourceProfiles?: Array<{
        platform?: string;
        platformKey?: string;
        externalAuthorId?: string;
        profileUrl?: string;
        score?: number;
        lastSyncedAt?: string;
      }>;
    },
  ) {
    return this.adminService.updateAuthor(id, body);
  }

  @Post('authors/merge')
  mergeAuthors(
    @Body()
    body: {
      primaryAuthorId?: string;
      secondaryAuthorId?: string;
    },
  ) {
    return this.adminService.mergeAuthors({
      primaryAuthorId: body.primaryAuthorId ?? '',
      secondaryAuthorId: body.secondaryAuthorId ?? '',
    });
  }

  @Post('authors/:id/detach-source-profiles')
  detachSourceProfiles(
    @Param('id') id: string,
    @Body()
    body: {
      sourceProfiles?: Array<{
        platform?: string;
        platformKey?: string;
        externalAuthorId?: string;
        profileUrl?: string;
        score?: number;
        lastSyncedAt?: string;
      }>;
      targetAuthorId?: string;
      newAuthor?: {
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
      };
      publicationIds?: string[];
      removeSelectedPublicationsFromSource?: boolean;
    },
  ) {
    return this.adminService.detachSourceProfiles(id, {
      sourceProfiles: body.sourceProfiles ?? [],
      targetAuthorId: body.targetAuthorId?.trim() || undefined,
      newAuthor: body.newAuthor,
      publicationIds: body.publicationIds ?? [],
      removeSelectedPublicationsFromSource:
        body.removeSelectedPublicationsFromSource,
    });
  }

  @Post('authors/:id/remove-source-profiles')
  removeSourceProfiles(
    @Param('id') id: string,
    @Body()
    body: {
      sourceProfiles?: Array<{
        platform?: string;
        platformKey?: string;
        externalAuthorId?: string;
        profileUrl?: string;
        score?: number;
        lastSyncedAt?: string;
      }>;
      publicationIds?: string[];
    },
  ) {
    return this.adminService.removeSourceProfiles(id, {
      sourceProfiles: body.sourceProfiles ?? [],
      publicationIds: body.publicationIds ?? [],
    });
  }

  @Post('publications/reassign')
  reassignPublications(
    @Body()
    body: {
      fromAuthorId?: string;
      toAuthorId?: string;
      publicationIds?: string[];
      removeFromSource?: boolean;
    },
  ) {
    return this.adminService.reassignPublications({
      fromAuthorId: body.fromAuthorId ?? '',
      toAuthorId: body.toAuthorId ?? '',
      publicationIds: body.publicationIds ?? [],
      removeFromSource: body.removeFromSource,
    });
  }

  private parseDateQuery(value?: string, endOfDay = false) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Gecersiz tarih parametresi: "${value}". ISO format kullanin.`,
      );
    }

    if (endOfDay) {
      parsed.setUTCHours(23, 59, 59, 999);
    } else {
      parsed.setUTCHours(0, 0, 0, 0);
    }

    return parsed;
  }
}
