import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PublicationSyncService } from '../catalog/publication-sync.service';
import {
  ApiActivityLog,
  ApiActivityLogDocument,
} from '../activity-log/schemas/api-activity-log.schema';

type ViewedAuthorQueueItem = {
  authorId: string;
  lastViewedAt: Date;
  viewCount: number;
};

type RunMonthlyViewedAuthorRefreshResult = {
  startedAt: string;
  lookbackDays: number;
  matchedAuthors: number;
  enqueuedAuthors: number;
  skippedAlreadyQueued: number;
  processedAuthors: number;
  alreadyRunning: boolean;
  finishedAt: string;
};

@Injectable()
export class MonthlyAuthorRefreshService {
  private readonly logger = new Logger(MonthlyAuthorRefreshService.name);
  private readonly queue: ViewedAuthorQueueItem[] = [];
  private readonly queuedAuthorIds = new Set<string>();
  private isProcessing = false;

  private readonly lookbackDays = this.parsePositiveInt(
    process.env.MONTHLY_AUTHOR_REFRESH_LOOKBACK_DAYS,
    30,
  );

  private readonly limitPerSource = this.parsePositiveInt(
    process.env.MONTHLY_AUTHOR_REFRESH_LIMIT_PER_SOURCE,
    25,
  );

  constructor(
    @InjectModel(ApiActivityLog.name)
    private readonly activityLogModel: Model<ApiActivityLogDocument>,
    private readonly publicationSyncService: PublicationSyncService,
  ) {}

  // Cron trigger intentionally stays disabled for now.
  // To enable this in the future:
  // 1. install @nestjs/schedule
  // 2. import ScheduleModule.forRoot() in AppModule
  // 3. uncomment the decorator + method below
  //
  // @Cron('0 3 1 * *')
  // async handleMonthlyViewedAuthorRefreshCron() {
  //   await this.runMonthlyViewedAuthorRefresh();
  // }

  async runMonthlyViewedAuthorRefresh(
    referenceDate = new Date(),
  ): Promise<RunMonthlyViewedAuthorRefreshResult> {
    const startedAt = new Date();
    const viewedAuthors = await this.loadRecentlyViewedAuthors(referenceDate);
    const enqueueResult = this.enqueueViewedAuthors(viewedAuthors);

    this.logger.log(
      `[Monthly Author Refresh] Queue prepared | authors=${viewedAuthors.length} | enqueued=${enqueueResult.enqueuedAuthors} | skippedAlreadyQueued=${enqueueResult.skippedAlreadyQueued}`,
    );

    const processResult = await this.processQueue();

    return {
      startedAt: startedAt.toISOString(),
      lookbackDays: this.lookbackDays,
      matchedAuthors: viewedAuthors.length,
      enqueuedAuthors: enqueueResult.enqueuedAuthors,
      skippedAlreadyQueued: enqueueResult.skippedAlreadyQueued,
      processedAuthors: processResult.processedAuthors,
      alreadyRunning: processResult.alreadyRunning,
      finishedAt: new Date().toISOString(),
    };
  }

  getQueueState() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      queuedAuthorIds: [...this.queuedAuthorIds],
    };
  }

  private async loadRecentlyViewedAuthors(referenceDate: Date) {
    const since = new Date(referenceDate);
    since.setDate(since.getDate() - this.lookbackDays);

    const rows = await this.activityLogModel
      .aggregate<{
        _id: string;
        lastViewedAt: Date;
        viewCount: number;
      }>([
        {
          $match: {
            action: 'author_detail_view',
            category: 'author',
            'entity.type': 'author',
            'response.success': true,
            createdAt: {
              $gte: since,
              $lte: referenceDate,
            },
          },
        },
        {
          $project: {
            authorId: {
              $ifNull: ['$entity.id', '$summary.authorId'],
            },
            createdAt: 1,
          },
        },
        {
          $match: {
            authorId: {
              $type: 'string',
              $nin: ['', 'null', 'undefined'],
            },
          },
        },
        {
          $group: {
            _id: '$authorId',
            lastViewedAt: { $max: '$createdAt' },
            viewCount: { $sum: 1 },
          },
        },
        {
          $sort: {
            viewCount: -1,
            lastViewedAt: -1,
          },
        },
      ])
      .exec();

    return rows
      .filter((row) => Types.ObjectId.isValid(row._id))
      .map((row) => ({
        authorId: row._id,
        lastViewedAt: row.lastViewedAt,
        viewCount: Number(row.viewCount ?? 0),
      }));
  }

  private enqueueViewedAuthors(items: ViewedAuthorQueueItem[]) {
    let enqueuedAuthors = 0;
    let skippedAlreadyQueued = 0;

    for (const item of items) {
      if (this.queuedAuthorIds.has(item.authorId)) {
        skippedAlreadyQueued += 1;
        continue;
      }

      this.queue.push(item);
      this.queuedAuthorIds.add(item.authorId);
      enqueuedAuthors += 1;
    }

    return {
      enqueuedAuthors,
      skippedAlreadyQueued,
    };
  }

  private async processQueue() {
    if (this.isProcessing) {
      this.logger.warn(
        '[Monthly Author Refresh] Queue is already being processed.',
      );
      return {
        processedAuthors: 0,
        alreadyRunning: true,
      };
    }

    this.isProcessing = true;
    let processedAuthors = 0;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) {
          continue;
        }

        this.queuedAuthorIds.delete(item.authorId);

        try {
          await this.refreshAuthorPublications(item);
          processedAuthors += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'unknown sync error';
          this.logger.error(
            `[Monthly Author Refresh] Failed | authorId=${item.authorId} | message=${message}`,
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return {
      processedAuthors,
      alreadyRunning: false,
    };
  }

  private async refreshAuthorPublications(item: ViewedAuthorQueueItem) {
    this.logger.log(
      `[Monthly Author Refresh] Sync started | authorId=${item.authorId} | viewCount=${item.viewCount} | lastViewedAt=${item.lastViewedAt.toISOString()}`,
    );

    const result = await this.publicationSyncService.syncAuthorPublications(
      item.authorId,
      this.limitPerSource,
      {
        force: true,
      },
    );

    this.logger.log(
      `[Monthly Author Refresh] Sync finished | authorId=${item.authorId} | harvested=${result.totalHarvested} | merged=${result.totalMerged} | upserted=${result.totalUpserted} | catalogCount=${result.catalogCount}`,
    );
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
