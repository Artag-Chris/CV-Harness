import { Controller, Post } from '@nestjs/common';
import { DedupService } from './dedup.service';

/** Dispara el pase de dedup a mano (además del cron `dedup-cycle`). */
@Controller('dedup')
export class DedupController {
  constructor(private readonly dedup: DedupService) {}

  @Post('run')
  run() {
    return this.dedup.run();
  }
}
