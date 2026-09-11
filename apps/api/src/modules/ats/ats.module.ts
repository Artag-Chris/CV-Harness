import { Module } from '@nestjs/common';
import { AtsController } from './ats.controller';
import { AtsService } from './ats.service';

/** Medidor de ATS: análisis determinístico + acomodo de keywords con IA. */
@Module({
  controllers: [AtsController],
  providers: [AtsService],
  exports: [AtsService],
})
export class AtsModule {}
