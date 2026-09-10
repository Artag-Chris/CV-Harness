import { describe, expect, it } from 'vitest';
import { VacanciesService } from '../src/modules/vacancies/vacancies.service';

/**
 * Verifica la construcción del `where` del listado. Se captura lo que el
 * servicio le pasa a Prisma: así el filtro de match queda cubierto sin BD.
 */
function makeService() {
  const captured: { where?: Record<string, unknown> } = {};
  const prisma = {
    vacancy: {
      findMany: (args: { where: Record<string, unknown> }) => {
        captured.where = args.where;
        return Promise.resolve([]);
      },
      count: () => Promise.resolve(0),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { service: new VacanciesService(prisma as never), captured };
}

describe('VacanciesService.list — filtro de match', () => {
  it('filtra por match >= minScore cuando se pide', async () => {
    const { service, captured } = makeService();
    await service.list({ minScore: 70 });
    expect(captured.where).toMatchObject({ matches: { some: { score: { gte: 70 } } } });
  });

  it('sin minScore no filtra por match (se ve todo)', async () => {
    const { service, captured } = makeService();
    await service.list({});
    expect(captured.where).not.toHaveProperty('matches');
  });

  it('un minScore no numérico se ignora en vez de romper', async () => {
    const { service, captured } = makeService();
    await service.list({ minScore: Number.NaN });
    expect(captured.where).not.toHaveProperty('matches');
  });

  it('combina el filtro de match con el de estado', async () => {
    const { service, captured } = makeService();
    await service.list({ status: 'MATCHED', minScore: 80 });
    expect(captured.where).toMatchObject({
      status: 'MATCHED',
      matches: { some: { score: { gte: 80 } } },
    });
  });
});
