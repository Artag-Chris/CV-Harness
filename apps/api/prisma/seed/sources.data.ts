// Fuentes de vacantes sembradas.
// 1) JobsDev Fixture: página local (nginx de docker-compose) para el E2E sin internet.
// 2) Computrabajo Colombia: receta HTML real, habilitada y autorreparable.
//
// `matchKey` identifica la fuente built-in aunque cambie su nombre o URL: el
// seed reescribe su receta en cada arranque (los selectores de los portales se
// rompen con los rediseños).

export interface SelectorRecipe {
  // Lista
  item: string;
  title: string;
  company?: string;
  location?: string;
  salary?: string;
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
  /** Prefijo estable para reconocer la fuente built-in en la BD. */
  matchKey: string;
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

// Computrabajo (Cloudflare) responde 403 a User-Agents no-navegador, incluido
// el anterior: hay que presentarse como un navegador real (verificado 2026-09).
const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const sourceSeeds: SourceSeed[] = [
  {
    name: 'JobsDev Fixture (E2E local)',
    matchKey: 'JobsDev',
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
    name: 'Computrabajo Colombia',
    matchKey: 'Computrabajo',
    kind: 'HTML_RECIPE',
    baseUrl: 'https://co.computrabajo.com',
    listUrl:
      'https://co.computrabajo.com/trabajo-de-desarrollador-y-programador',
    // Selectores verificados contra el HTML real (2026-09). Ver
    // SOURCE_TEMPLATES.computrabajo-co para el detalle de cada uno.
    selectors: {
      item: 'article.box_offer',
      title: 'h2 a.js-o-link',
      company: 'a.t_ellipsis',
      location: 'p.fs16.fc_base.mt5:not(.dFlex) span.mr10',
      salary: 'div.fs13 span.dIB.mr10',
      postedAt: 'p.fs13.fc_aux',
      applyUrl: 'h2 a.js-o-link',
      nextPage: '[title="Siguiente"]',
      fetchDetail: true,
      detail: {
        description: 'div[div-link="oferta"]',
      },
    },
    limits: {
      maxPages: 2,
      delayMs: 1000,
      timeoutMs: 20000,
      userAgent: browserUserAgent,
      respectRobots: true,
    },
    enabled: true,
    intervalMinutes: 1440,
  },
];
