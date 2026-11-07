import { Module } from '@nestjs/common';
import { SerpapiController } from './serpapi.controller';
import { SerpapiService } from './serpapi.service';

@Module({
  controllers: [SerpapiController],
  providers: [SerpapiService],
  exports: [SerpapiService],
})
export class SerpapiModule {}
