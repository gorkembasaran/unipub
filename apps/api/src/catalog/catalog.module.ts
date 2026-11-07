import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PublicationSyncService } from './publication-sync.service';
import { Author, AuthorSchema } from './schemas/author.schema';
import { Institution, InstitutionSchema } from './schemas/institution.schema';
import {
  Publication,
  PublicationSchema,
} from './schemas/publication.schema';
import { ClarivateModule } from '../clarivate/clarivate.module';
import { TrdizinModule } from '../trdizin/trdizin.module';
import { SerpapiModule } from '../serpapi/serpapi.module';
import { ScraperModule } from '../scraper/scraper.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ClarivateModule,
    TrdizinModule,
    SerpapiModule,
    ScraperModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Author.name, schema: AuthorSchema },
      { name: Institution.name, schema: InstitutionSchema },
      { name: Publication.name, schema: PublicationSchema },
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, PublicationSyncService],
  exports: [CatalogService, PublicationSyncService],
})
export class CatalogModule {}
