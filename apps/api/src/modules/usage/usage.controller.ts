import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LlmUsageService } from '../llm/llm-usage.service';

/** Medidor de consumo de IA y estado del tope diario (tokens/USD). */
@ApiTags('usage')
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: LlmUsageService) {}

  @Get()
  @ApiOperation({ summary: 'Consumo de IA del día, acumulado y desglose por etapa' })
  summary(@Query('days') days?: string) {
    const parsed = days ? Number.parseInt(days, 10) : 14;
    return this.usage.getSummary(Number.isFinite(parsed) ? parsed : 14);
  }
}
