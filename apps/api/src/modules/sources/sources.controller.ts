import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateSourceDto } from '../../common/api-dto';
import { DispatchService } from '../scheduler/dispatch.service';
import { RecipeProbeService } from './probe/recipe-probe.service';
import { SourcesService } from './sources.service';

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly dispatch: DispatchService,
    private readonly probe: RecipeProbeService,
  ) {}

  @Get()
  list(@Query('profileId') profileId?: string) {
    return profileId ? this.sources.listByProfile(profileId) : this.sources.list();
  }

  @Get('templates')
  templates() {
    return this.sources.templates();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sources.get(id);
  }

  /**
   * Analiza una URL de listado y PROPONE una receta (plantilla → heurística →
   * IA), validada contra el HTML real. No guarda nada: el usuario confirma.
   */
  @Post('probe')
  analyze(@Body() body: { listUrl?: string }) {
    if (!body?.listUrl?.trim()) {
      throw new BadRequestException('listUrl es requerido');
    }
    return this.probe.probe(body.listUrl.trim());
  }

  @Post()
  create(@Body() body: CreateSourceDto) {
    return this.sources.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.sources.update(id, body);
  }

  /** Borra la fuente; con force=true elimina también sus vacantes y matches. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('force') force?: string) {
    const result = await this.sources.remove(id, force === 'true' || force === '1');
    return { ok: true, ...result };
  }

  /** Disparo manual de scraping (event-driven: encola y responde ya). */
  @Post(':id/run')
  async run(@Param('id') id: string) {
    const { requestId } = await this.dispatch.runSource(id);
    return { ok: true, requestId };
  }
}
