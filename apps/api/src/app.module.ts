import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TrdizinModule } from './trdizin/trdizin.module';
import { ScraperModule } from './scraper/scraper.module';
import { SerpapiModule } from './serpapi/serpapi.module';
import { CatalogModule } from './catalog/catalog.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { AuthModule } from './auth/auth.module';
import { ClarivateModule } from './clarivate/clarivate.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { AdminModule } from './admin/admin.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { OpenalexModule } from './openalex/openalex.module';
import { SourceAccessGuard } from './common/source-access.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGO_URI') ??
          'mongodb://127.0.0.1:27017/unipub_local',
        dbName: configService.get<string>('MONGO_DB_NAME') ?? 'unipub_local',
      }),
    }),
    TrdizinModule,
    ScraperModule,
    SerpapiModule,
    CatalogModule,
    DiscoveryModule,
    AuthModule,
    AdminModule,
    ClarivateModule,
    ActivityLogModule,
    MaintenanceModule,
    OpenalexModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: SourceAccessGuard }],
})
export class AppModule {}
