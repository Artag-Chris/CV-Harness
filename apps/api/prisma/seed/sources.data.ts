// Fuentes de vacantes sembradas.
// 1) JobsDev Fixture: página local (nginx de docker-compose) para el E2E sin internet.
// 2) Computrabajo Colombia: ejemplo documentado de receta HTML real (deshabilitado).

export interface SelectorRecipe {
  // Lista
  item: string;
  title: string;
  company?: string;
  location?: string;
  postedAt?: string;
  description?: string;
  applyUrl?: string;
  nextPage?: string;
  // Detalle (opcional, se fetchea el item si no hay descripción en lista)
  fetchDetail?: boolean;
  detailUrlAttr?: 'href' | 'data-url';
  detail?: {
    description?: string;
    company?: string;
    location?: string;
    postedAt?: string;
  };
}

export interface SourceSeed {
  name: string;
  kind: string;
  baseUrl: string;
  listUrl: string;
  selectors: SelectorRecipe;
  limits: {
    maxPages: number;
    delayMs: number;
    timeoutMs: number;
    userAgent: string;
    respectRobots: boolean;
  };
  enabled: boolean;
  intervalMinutes: number;
}

const userAgent =
  'cv-harness/0.1 (+tracker personal de vacantes; contacto: scristxyz@gmail.com)';

export const sourceSeeds: SourceSeed[] = [
  {
    name: 'JobsDev Fixture (E2E local)',
    kind: 'HTML_RECIPE',
    baseUrl: 'http://localhost:8090',
    listUrl: 'http://localhost:8090/jobs.html',
    selectors: {
      item: '.job-item',
      title: '.job-title a',
      company: '.job-company',
      location: '.job-location',
      postedAt: '.job-date',
      description: '.job-description',
      applyUrl: '.job-title a',
    },
    limits: {
      maxPages: 1,
      delayMs: 300,
      timeoutMs: 15000,
      userAgent,
      respectRobots: false,
    },
    enabled: true,
    intervalMinutes: 30,
  },
  {
    name: 'Computrabajo Colombia (ejemplo deshabilitado)',
    kind: 'HTML_RECIPE',
    baseUrl: 'https://www.computrabajo.com.co',
    listUrl:
      'https://www.computrabajo.com.co/trabajo-de-desarrollador-y-programador',
    selectors: {
      item: 'article.box_oferta, .b-ox-oferta',
      title: 'h2 a, .tOferta a',
      company: '.dataOferta .e, .dOferta .e',
      location: '.dataOferta .d, .lc',
      postedAt: '.dataOferta .f, .fc',
      description: '.dOferta .fs16, .cOferta',
      applyUrl: 'h2 a',
      nextPage: 'a[title="Siguiente"], .paginado a:has-text("Siguiente")',
      fetchDetail: true,
      detail: {
        description: '.box_detalle_oferta, .ficha_oferta',
      },
    },
    limits: {
      maxPages: 2,
      delayMs: 1200,
      timeoutMs: 20000,
      userAgent,
      respectRobots: true,
    },
    enabled: false,
    intervalMinutes: 1440,
  },
];
