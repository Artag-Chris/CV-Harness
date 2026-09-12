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

describe('VacanciesService.list — alcance por perfil', () => {
  it('con profileId solo lista las vacantes que ese perfil evaluó', async () => {
    const { service, captured } = makeService();
    await service.list({ profileId: 'p-juan' });
    expect(captured.where).toMatchObject({
      vacancyProfiles: { some: { profileId: 'p-juan' } },
    });
  });

  it('con profileId, minScore se mide contra el match de ESE perfil', async () => {
    const { service, captured } = makeService();
    await service.list({ profileId: 'p-juan', minScore: 70 });
    expect(captured.where).toMatchObject({
      matches: { some: { profileId: 'p-juan', score: { gte: 70 } } },
    });
  });

  it('el score de la fila es el del perfil elegido, no el mejor global', async () => {
    const { service } = makeServiceWithRows([
      {
        id: 'v1',
        matchScore: 95, // agregado global (otro perfil)
        matches: [
          { id: 'm1', score: 95, verdict: 'GOOD_MATCH', profileId: 'p-otro' },
          { id: 'm2', score: 40, verdict: 'WEAK', profileId: 'p-juan' },
        ],
        vacancyProfiles: [
          { id: 'vp1', status: 'MATCHED', profile: { id: 'p-otro', name: 'Otro' } },
          { id: 'vp2', status: 'MATCHED', profile: { id: 'p-juan', name: 'Juan' } },
        ],
        drafts: [{ id: 'd1', profileId: 'p-otro', status: 'DRAFT', version: 1, updatedAt: new Date() }],
        source: { id: 's1', name: 'Computrabajo' },
      },
    ]);

    const scoped = await service.list({ profileId: 'p-juan' });
    expect(scoped.rows[0].matchScore).toBe(40);
    // Juan no tiene HV generada (la del otro perfil no se le atribuye).
    expect(scoped.rows[0].resume).toBeNull();

    const global = await service.list({});
    expect(global.rows[0].matchScore).toBe(95);
  });
});

function makeServiceWithRows(rows: Record<string, unknown>[]) {
  const prisma = {
    vacancy: {
      findMany: () => Promise.resolve(rows),
      count: () => Promise.resolve(rows.length),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { service: new VacanciesService(prisma as never) };
}

describe('VacanciesService.get — detalle por perfil', () => {
  const detailRow = {
    id: 'v1',
    matchScore: 95,
    source: { id: 's1', name: 'Computrabajo', baseUrl: 'https://x.com' },
    vacancyProfiles: [
      { id: 'vp1', status: 'MATCHED', profile: { id: 'p-otro', name: 'Otro' } },
      { id: 'vp2', status: 'APPLIED', profile: { id: 'p-juan', name: 'Juan' } },
    ],
    matches: [
      { id: 'm1', score: 95, verdict: 'GOOD_MATCH', profileId: 'p-otro', reasons: [], gaps: [] },
      { id: 'm2', score: 40, verdict: 'WEAK', profileId: 'p-juan', reasons: [], gaps: [] },
    ],
    drafts: [
      { id: 'd1', profileId: 'p-otro', version: 1, status: 'DRAFT', content: {} },
    ],
  };
  function makeDetailService() {
    const prisma = {
      vacancy: { findUnique: () => Promise.resolve(detailRow) },
    };
    return new VacanciesService(prisma as never);
  }

  it('sin profileId muestra el mejor match', async () => {
    const detail = await makeDetailService().get('v1');
    expect(detail.match?.score).toBe(95);
    expect(detail.matchScore).toBe(95);
  });

  it('con profileId muestra el match de ese perfil (y su estado)', async () => {
    const detail = await makeDetailService().get('v1', 'p-juan');
    expect(detail.match?.score).toBe(40);
    expect(detail.matchScore).toBe(40);
    // Juan no tiene borrador de HV: no se le atribuye el del otro perfil.
    expect(detail.resume).toBeNull();
    // El bloque de perfiles trae el estado por perfil para la UI.
    expect(detail.profiles).toMatchObject([
      { profileId: 'p-otro', score: 95 },
      { profileId: 'p-juan', score: 40, status: 'APPLIED' },
    ]);
  });

  function makeServiceForRow(row: Record<string, unknown>) {
    const prisma = { vacancy: { findUnique: () => Promise.resolve(row) } };
    return new VacanciesService(prisma as never);
  }

  /**
   * Regresión: Computrabajo entrega el href del aviso relativo
   * (`/ofertas-de-trabajo/…`) y el scraper lo guardaba crudo en `raw.applyUrl`,
   * así que «Abrir el aviso» no abría nada. El API lo absolutiza contra el portal.
   */
  it('resuelve el href relativo del aviso contra la baseUrl de la fuente', async () => {
    const detail = await makeServiceForRow({
      ...detailRow,
      source: { id: 's1', name: 'Computrabajo', baseUrl: 'https://co.computrabajo.com', listUrl: 'https://co.computrabajo.com/trabajo-de-dev' },
      url: 'https://co.computrabajo.com/ofertas-de-trabajo/oferta-1',
      raw: { applyUrl: '/ofertas-de-trabajo/oferta-1#lc=ListOffers-Score4-16' },
    }).get('v1');

    expect(detail.applyUrl).toBe(
      'https://co.computrabajo.com/ofertas-de-trabajo/oferta-1#lc=ListOffers-Score4-16',
    );
  });

  it('sin baseUrl toma el host del listUrl de la fuente', async () => {
    const detail = await makeServiceForRow({
      ...detailRow,
      source: { id: 's1', name: 'Computrabajo', baseUrl: null, listUrl: 'https://co.computrabajo.com/trabajo-de-dev' },
      url: 'https://co.computrabajo.com/ofertas-de-trabajo/oferta-2',
      raw: { applyUrl: '/ofertas-de-trabajo/oferta-2' },
    }).get('v1');

    expect(detail.applyUrl).toBe('https://co.computrabajo.com/ofertas-de-trabajo/oferta-2');
  });

  it('si el href no se puede resolver usa la url de la vacante', async () => {
    const detail = await makeServiceForRow({
      ...detailRow,
      source: { id: 's1', name: 'Manual', baseUrl: null, listUrl: '' },
      url: 'https://ejemplo.com/aviso/3',
      raw: { applyUrl: '/relativo-sin-base' },
    }).get('v1');

    expect(detail.applyUrl).toBe('https://ejemplo.com/aviso/3');
  });

  it('un aviso ya absoluto se deja igual', async () => {
    const detail = await makeServiceForRow({
      ...detailRow,
      url: 'https://fitly.work/jobs/9',
      raw: { applyUrl: 'https://fitly.work/jobs/9' },
    }).get('v1');

    expect(detail.applyUrl).toBe('https://fitly.work/jobs/9');
  });
});

describe('VacanciesService.list — filtros de facets', () => {
  it('filtra por modalidad canónica de forma inclusiva', async () => {
    const { service, captured } = makeService();
    await service.list({ modality: ['REMOTE'] });
    expect(captured.where).toMatchObject({ modalityTypes: { hasSome: ['REMOTE'] } });
  });

  it('sin modalidad no agrega el filtro (se ve todo)', async () => {
    const { service, captured } = makeService();
    await service.list({ modality: [] });
    expect(captured.where).not.toHaveProperty('modalityTypes');
  });

  it('filtra por seniority canónico', async () => {
    const { service, captured } = makeService();
    await service.list({ seniority: ['SENIOR', 'SEMI_SENIOR'] });
    expect(captured.where).toMatchObject({
      seniorityLevel: { in: ['SENIOR', 'SEMI_SENIOR'] },
    });
  });

  it('filtra por ubicación por texto (insensible a mayúsculas)', async () => {
    const { service, captured } = makeService();
    await service.list({ location: 'Bogotá' });
    expect(captured.where).toMatchObject({
      location: { contains: 'Bogotá', mode: 'insensitive' },
    });
  });

  it('combina los facets con estado, perfil y minScore', async () => {
    const { service, captured } = makeService();
    await service.list({
      status: 'MATCHED',
      profileId: 'p-juan',
      minScore: 70,
      modality: ['HYBRID'],
      seniority: ['SENIOR'],
      location: 'remoto',
    });
    expect(captured.where).toMatchObject({
      status: 'MATCHED',
      modalityTypes: { hasSome: ['HYBRID'] },
      seniorityLevel: { in: ['SENIOR'] },
      matches: { some: { profileId: 'p-juan', score: { gte: 70 } } },
    });
  });
});
