import { Controller, Get } from '@nestjs/common';
import { env } from '../../config/env';

/**
 * Flags que el dashboard necesita para ajustar sus textos (ej. si la HV
 * automática está apagada, el botón de generar pasa a ser la vía principal).
 */
@Controller('config')
export class AppConfigController {
  @Get()
  get() {
    return {
      autoResumeEnabled: env.AUTO_RESUME_ENABLED,
      dedupEnabled: env.DEDUP_ENABLED,
    };
  }
}
