import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SourcesService } from '../src/modules/sources/sources.service';

/**
 * Validación de recetas del editor avanzado. La validación ocurre antes de
 * tocar la BD, así que alcanza con un PrismaService vacío: los casos inválidos
 * nunca llegan a consultarlo.
 */
const service = new SourcesService({} as never);

const base = { name: 'Portal X', listUrl: 'https://x.com/ofertas' };

describe('SourcesService.create — validación de receta', () => {
  it('exige plantilla o selectores', async () => {
    await expect(service.create(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige selectors.item', async () => {
    await expect(
      service.create({ ...base, selectors: { title: 'h2 a' } }),
    ).rejects.toThrow(/item es obligatorio/);
  });

  it('exige selectors.title', async () => {
    await expect(
      service.create({ ...base, selectors: { item: 'article.oferta' } }),
    ).rejects.toThrow(/title es obligatorio/);
  });

  it('rechaza un templateId inexistente', async () => {
    await expect(
      service.create({ ...base, templateId: 'no-existe' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta una receta mínima válida', async () => {
    // Con selectores válidos sigue a la BD: se verifica que la validación pase
    // (el error que llega es del prisma vacío, no un 400 de validación).
    await expect(
      service.create({ ...base, selectors: { item: '.job', title: 'h2 a' } }),
    ).rejects.not.toBeInstanceOf(BadRequestException);
  });
});

/** Prisma mínimo que captura lo que se intenta escribir. */
function makeService() {
  const writes: Record<string, unknown>[] = [];
  const prisma = {
    source: {
      create: (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        return Promise.resolve({ id: 's1', ...args.data });
      },
    },
  };
  return { service: new SourcesService(prisma as never), writes };
}

describe('SourcesService.create — fuentes por API oficial', () => {
  /**
   * El flujo real del dashboard: el usuario elige la plantilla "Jooble" en el
   * selector y guarda. El `kind` sale de la plantilla, no del body.
   */
  it('crea una fuente API_JSON desde la plantilla de Jooble', async () => {
    const { service, writes } = makeService();
    await service.create({
      name: 'Jooble desarrollador',
      listUrl: 'https://co.jooble.org/SearchResult?ukw=desarrollador',
      templateId: 'jooble-api',
    });

    expect(writes[0].kind).toBe('API_JSON');
    const selectors = writes[0].selectors as { api: { url: string; authEnv: string } };
    expect(selectors.api.url).toBe('https://jooble.org/api/{key}');
    expect(selectors.api.authEnv).toBe('JOOBLE_API_KEY');
    // Hereda los límites de la plantilla: 1 página y reintentos contra el WAF.
    const limits = writes[0].limits as { maxPages: number; retryAttempts: number };
    expect(limits.maxPages).toBe(1);
    expect(limits.retryAttempts).toBe(3);
  });

  it('acepta una spec de API explícita (editor del dashboard)', async () => {
    const { service, writes } = makeService();
    await service.create({
      name: 'Otra API',
      listUrl: 'https://x.com/ofertas',
      kind: 'API_JSON',
      selectors: { api: { url: 'https://x.com/jobs', mapping: { title: 't', url: 'u' } } },
    });
    expect(writes[0].kind).toBe('API_JSON');
  });

  it('rechaza una fuente API con receta CSS (kind y receta no coinciden)', async () => {
    const { service } = makeService();
    await expect(
      service.create({
        name: 'Rota',
        listUrl: 'https://x.com/ofertas',
        kind: 'API_JSON',
        selectors: { item: '.job', title: 'h2 a' },
      }),
    ).rejects.toThrow(/api/i);
  });
});
