import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogInterceptor } from './activity-log.interceptor';
import { ActivityLogService } from './activity-log.service';
import {
  ApiActivityLog,
  ApiActivityLogSchema,
} from './schemas/api-activity-log.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ApiActivityLog.name, schema: ApiActivityLogSchema },
    ]),
  ],
  controllers: [ActivityLogController],
  providers: [
    ActivityLogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLogInterceptor,
    },
  ],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
