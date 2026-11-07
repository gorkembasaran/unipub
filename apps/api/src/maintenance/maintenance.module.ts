import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CatalogModule } from '../catalog/catalog.module';
import {
  ApiActivityLog,
  ApiActivityLogSchema,
} from '../activity-log/schemas/api-activity-log.schema';
import { MonthlyAuthorRefreshService } from './monthly-author-refresh.service';

@Module({
  imports: [
    ActivityLogModule,
    CatalogModule,
    MongooseModule.forFeature([
      { name: ApiActivityLog.name, schema: ApiActivityLogSchema },
    ]),
  ],
  providers: [MonthlyAuthorRefreshService],
  exports: [MonthlyAuthorRefreshService],
})
export class MaintenanceModule {}
