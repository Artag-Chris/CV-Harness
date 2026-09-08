import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DispatchService } from '../scheduler/dispatch.service';
import { SourcesService } from './sources.service';

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly dispatch: DispatchService,
  ) {}

  @Get()
  list() {
    return this.sources.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sources.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.sources.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.sources.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.sources.remove(id);
    return { ok: true };
  }

  /** Disparo manual de scraping (event-driven: encola y responde ya). */
  @Post(':id/run')
  async run(@Param('id') id: string) {
    const { requestId } = await this.dispatch.runSource(id);
    return { ok: true, requestId };
  }
}
