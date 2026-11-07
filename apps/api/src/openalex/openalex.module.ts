import { Module } from '@nestjs/common';
import { OpenalexController } from './openalex.controller';
import { OpenalexService } from './openalex.service';

@Module({
  controllers: [OpenalexController],
  providers: [OpenalexService],
  exports: [OpenalexService],
})
export class OpenalexModule {}
