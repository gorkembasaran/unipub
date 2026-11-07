import { Module } from '@nestjs/common';
import { ClarivateController } from './clarivate.controller';
import { ClarivateService } from './clarivate.service';

@Module({
  controllers: [ClarivateController],
  providers: [ClarivateService],
  exports: [ClarivateService],
})
export class ClarivateModule {}
