import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AdminAuthGuard,
} from '../auth/admin-auth.guard';
import type { AdminAuthenticatedRequest } from '../auth/admin-auth.guard';
import { ActivityLogService } from './activity-log.service';

@Controller('admin/activity-logs')
@UseGuards(AdminAuthGuard)
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  listLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('status') status?: string,
    @Query('success') success?: string,
    @Query('actorType') actorType?: string,
    @Query('entityType') entityType?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.activityLogService.listLogs({
      page: this.parsePositiveInteger(page, 1, 1, 100000),
      pageSize: this.parsePositiveInteger(pageSize, 20, 1, 100),
      category: category?.trim() || undefined,
      action: action?.trim() || undefined,
      status: status?.trim() || undefined,
      success: this.parseBooleanQuery(success),
      actorType: actorType?.trim() || undefined,
      entityType: entityType?.trim() || undefined,
      q: q?.trim() || undefined,
      from: this.parseDateQuery(from, false),
      to: this.parseDateQuery(to, true),
    });
  }

  @Get(':id')
  getLog(@Param('id') id: string) {
    return this.activityLogService.getLogById(id);
  }

  @Patch(':id')
  updateLog(
    @Param('id') id: string,
    @Body()
    body: {
      action?: string;
      category?: string;
      actor?: Record<string, unknown>;
      entity?: Record<string, unknown>;
      request?: Record<string, unknown>;
      response?: Record<string, unknown>;
      error?: Record<string, unknown> | null;
      summary?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      admin?: {
        status?: string;
        tags?: string[];
        note?: string;
        pinned?: boolean;
      };
    },
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.activityLogService.updateLog(id, body, request.user);
  }

  @Delete(':id')
  deleteLog(@Param('id') id: string) {
    return this.activityLogService.deleteLog(id);
  }

  private parsePositiveInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    if (!value?.trim()) {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(
        `Gecersiz sayi parametresi: "${value}". ${min}-${max} araliginda tam sayi kullanin.`,
      );
    }

    return parsed;
  }

  private parseBooleanQuery(value?: string) {
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) {
      return undefined;
    }
    if (['1', 'true', 'yes', 'on'].includes(trimmed)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(trimmed)) {
      return false;
    }

    throw new BadRequestException(
      `Gecersiz boolean parametresi: "${value}". true/false kullanin.`,
    );
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
}
