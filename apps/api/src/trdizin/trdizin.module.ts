import { Module } from '@nestjs/common';
import { TrdizinController } from './trdizin.controller';
import { TrdizinService } from './trdizin.service';

@Module({
  controllers: [TrdizinController],
  providers: [TrdizinService],
  exports: [TrdizinService],
})
export class TrdizinModule {}
