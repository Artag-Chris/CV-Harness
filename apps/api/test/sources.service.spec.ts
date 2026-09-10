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
