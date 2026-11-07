import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ClarivateModule } from '../clarivate/clarivate.module';
import { ScraperModule } from '../scraper/scraper.module';
import { SerpapiModule } from '../serpapi/serpapi.module';
import { TrdizinModule } from '../trdizin/trdizin.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [
    AuthModule,
    SerpapiModule,
    TrdizinModule,
    ScraperModule,
    ClarivateModule,
    CatalogModule,
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
