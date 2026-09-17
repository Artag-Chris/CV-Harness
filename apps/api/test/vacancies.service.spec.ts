import { describe, expect, it } from 'vitest';
import { VacanciesService } from '../src/modules/vacancies/vacancies.service';

/** Colas no usadas en estos casos (el servicio solo las toca en acciones). */
const stubQueue = { add: () => Promise.resolve({}) } as never;

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
  return { service: new VacanciesService(prisma as never, stubQueue, stubQueue), captured };
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
  return { service: new VacanciesService(prisma as never, stubQueue, stubQueue) };
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
    interviewPreps: [],
    duplicates: [],
    duplicateOf: null,
    _count: { duplicates: 0 },
  };
  function makeDetailService() {
    const prisma = {
      vacancy: { findUnique: () => Promise.resolve(detailRow) },
    };
    return new VacanciesService(prisma as never, stubQueue, stubQueue);
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

  it('expone la preparación de entrevista del perfil elegido', async () => {
    const detail = await makeServiceForRow({
      ...detailRow,
      interviewPreps: [
        {
          id: 'ip1',
          profileId: 'p-juan',
          version: 2,
          status: 'FINAL',
          source: 'ia',
          content: { summary: 'Plan de Juan' },
          profile: { id: 'p-juan', name: 'Juan' },
        },
      ],
    }).get('v1', 'p-juan');

    expect(detail.interview?.id).toBe('ip1');
    expect(detail.profiles.find((p) => p.profileId === 'p-juan')?.interview?.id).toBe('ip1');
    // Al otro perfil no se le atribuye la preparación.
    expect(detail.profiles.find((p) => p.profileId === 'p-otro')?.interview).toBeNull();
  });

  function makeServiceForRow(row: Record<string, unknown>) {
    const prisma = { vacancy: { findUnique: () => Promise.resolve(row) } };
    return new VacanciesService(prisma as never, stubQueue, stubQueue);
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

describe('VacanciesService.list — duplicados', () => {
  it('por defecto oculta los marcados como duplicados', async () => {
    const { service, captured } = makeService();
    await service.list({});
    expect(captured.where).toMatchObject({ duplicateOfId: null });
  });

  it("con duplicates='show' muestra solo los duplicados", async () => {
    const { service, captured } = makeService();
    await service.list({ duplicates: 'show' });
    expect(captured.where).toMatchObject({ duplicateOfId: { not: null } });
  });

  it("con duplicates='all' no filtra por duplicado", async () => {
    const { service, captured } = makeService();
    await service.list({ duplicates: 'all' });
    expect(captured.where).not.toHaveProperty('duplicateOfId');
  });
});

describe('VacanciesService.markNotDuplicate', () => {
  const detail = {
    id: 'v1',
    title: 'Dev',
    company: 'Acme',
    location: null,
    salary: null,
    modality: null,
    modalityTypes: [],
    seniorityLevel: null,
    url: 'https://x.com/job/1',
    raw: {},
    status: 'RAW',
    matchScore: null,
    enrichment: null,
    source: { id: 's1', name: 'F', baseUrl: null, listUrl: '', kind: 'HTML_RECIPE' },
    vacancyProfiles: [],
    matches: [],
    drafts: [],
    interviewPreps: [],
    duplicates: [],
    duplicateOf: null,
    _count: { duplicates: 0 },
  };

  function make(opts: { status: string; duplicateOfId: string | null }) {
    const updates: Record<string, unknown>[] = [];
    const normalizeJobs: { data: unknown; opts: { jobId?: string } }[] = [];
    const prisma = {
      vacancy: {
        findUnique: (args: { select?: Record<string, unknown> }) =>
          Promise.resolve(
            args.select ? { id: 'v1', status: opts.status, duplicateOfId: opts.duplicateOfId } : detail,
          ),
        update: (args: Record<string, unknown>) => {
          updates.push(args);
          return Promise.resolve({});
        },
      },
    };
    const service = new VacanciesService(
      prisma as never,
      { add: () => Promise.resolve({}) } as never,
      {
        add: (_n: string, data: unknown, o: { jobId?: string }) => {
          normalizeJobs.push({ data, opts: o });
          return Promise.resolve({});
        },
      } as never,
    );
    return { service, updates, normalizeJobs };
  }

  it('desmarca, recuerda y reprocesa si había quedado sin normalizar', async () => {
    const { service, updates, normalizeJobs } = make({ status: 'RAW', duplicateOfId: 'v-canon' });

    await service.markNotDuplicate('v1');

    expect(updates[0]).toEqual({
      where: { id: 'v1' },
      data: { duplicateOfId: null, dupDismissed: true },
    });
    expect(normalizeJobs).toHaveLength(1);
    expect(normalizeJobs[0].opts.jobId).toBe('normalize-v1');
  });

  it('no reprocesa si la vacante ya estaba analizada', async () => {
    const { service, normalizeJobs } = make({ status: 'MATCHED', duplicateOfId: 'v-canon' });

    await service.markNotDuplicate('v1');

    expect(normalizeJobs).toHaveLength(0);
  });
});
