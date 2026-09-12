/**
 * Plantillas de portales: permiten crear una fuente pegando solo la URL del
 * listado. El editor avanzado de selectores CSS cubre el resto de sitios.
 *
 * Vive en su propio archivo para que el analizador de URLs y los tests puedan
 * usarlas sin arrastrar Prisma.
 */

export interface SourceTemplate {
  id: string;
  label: string;
  hint: string;
  baseUrlDefault: string;
  /** Tipo de fuente: `HTML_RECIPE` (por defecto) o `API_JSON` (API oficial). */
  kind?: string;
  selectors: Record<string, unknown>;
  limits: Record<string, unknown>;
}

export const SOURCE_TEMPLATES: SourceTemplate[] = [
  {
    id: 'computrabajo-co',
    label: 'Computrabajo Colombia',
    hint: 'URL del listado, ej. https://co.computrabajo.com/trabajo-de-desarrollador-y-programador',
    // www.computrabajo.com.co redirige (301) a co.computrabajo.com.
    baseUrlDefault: 'https://co.computrabajo.com',
    // Selectores verificados contra el HTML real (2026-09):
    //   <article class="box_offer …"> / <h2><a class="js-o-link">Título</a></h2>
    //   empresa: <a class="t_ellipsis"> · ubicación: <p class="fs16 fc_base mt5"><span class="mr10">
    //   salario: <div class="fs13 mt15"><span class="dIB mr10"> · publicada: <p class="fs13 fc_aux">
    //   paginación: <span title="Siguiente" data-path="…?p=2"> (NO es <a href>)
    selectors: {
      item: 'article.box_offer',
      title: 'h2 a.js-o-link',
      company: 'a.t_ellipsis',
      // :not(.dFlex) descarta el párrafo de la empresa, que en ofertas con
      // calificación trae <span class="fx_none mr10">4,7</span>.
      location: 'p.fs16.fc_base.mt5:not(.dFlex) span.mr10',
      salary: 'div.fs13 span.dIB.mr10',
      postedAt: 'p.fs13.fc_aux',
      applyUrl: 'h2 a.js-o-link',
      nextPage: '[title="Siguiente"]',
      // El listado no trae la descripción: se baja la página de detalle.
      fetchDetail: true,
      detail: { description: 'div[div-link="oferta"]' },
    },
    limits: {
      maxPages: 2,
      delayMs: 1000,
      timeoutMs: 20000,
      // Computrabajo (Cloudflare) responde 403 a UAs no-navegador
      // (`curl`, `cv-harness/0.1`): verificado 2026-09.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      respectRobots: true,
    },
  },
  {
    id: 'jooble-api',
    label: 'Jooble (API oficial)',
    hint: 'Pegá la URL de búsqueda de Jooble (ej. https://co.jooble.org/SearchResult?ukw=desarrollador). Necesita la variable de entorno JOOBLE_API_KEY; la key se pide gratis en https://jooble.org/api/about. Ojo: el endpoint es siempre jooble.org (el host de país responde 403) y el catálogo es internacional — con location:"Colombia" esta key devolvió 0 resultados, así que el body por defecto NO filtra ubicación.',
    // Jooble responde 403 a todo cliente que no sea un navegador con challenge
    // resuelto (Cloudflare Turnstile), así que la vía estable es su API REST.
    baseUrlDefault: 'https://co.jooble.org',
    kind: 'API_JSON',
    selectors: {
      api: {
        // La key va en la ruta (formato de Jooble); se inyecta desde el entorno.
        // El host CON país (co.jooble.org/api/…) queda detrás del challenge: 403.
        url: 'https://jooble.org/api/{key}',
        method: 'POST',
        authEnv: 'JOOBLE_API_KEY',
        // `{{page}}` lo reemplaza el harness en cada página. Sin `location`:
        // agregarlo restringe y puede dejar la corrida en 0.
        body: { keywords: 'desarrollador programador', page: '{{page}}' },
        itemsPath: 'jobs',
        mapping: {
          title: 'title',
          url: 'link',
          company: 'company',
          location: 'location',
          salary: 'salary',
          postedAt: 'updated',
          description: 'snippet',
          externalId: 'id',
          // Jooble es un agregador: `source` dice en qué portal vive el aviso
          // real ("fitly.work"), que es lo que el usuario necesita para aplicar.
          originSource: 'source',
        },
      },
    },
    limits: {
      // Una sola página a propósito: el endpoint de Jooble está detrás de
      // Cloudflare y castiga los requests seguidos (alterna 200/403/500).
      maxPages: 1,
      delayMs: 2000,
      timeoutMs: 20000,
      retryAttempts: 3,
      retryDelayMs: 2500,
      respectRobots: true,
    },
  },
  {
    id: 'careerjet-co',
    label: 'Careerjet / OpcionEmpleo (API oficial)',
    hint: 'Agregador con API pública (Colombia = OpcionEmpleo). Sirve para portales que NO se pueden raspar (Indeed, LinkedIn): los indexa y devuelve el enlace al aviso original. Necesita la variable de entorno CAREERJET_API_KEY; la key sale gratis creando una cuenta de publisher en https://www.careerjet.com/partners/register/as-publisher. La API exige `user_ip`/`user_agent` (van fijos en la receta: poné la IP de tu servidor) y el header `Referer`, que debería ser el sitio con el que registraste la cuenta.',
    baseUrlDefault: 'https://www.opcionempleo.com.co',
    kind: 'API_JSON',
    selectors: {
      api: {
        // v4: Basic auth (usuario = key, password vacío) y GET con query.
        url: 'https://search.api.careerjet.net/v4/query',
        method: 'GET',
        authEnv: 'CAREERJET_API_KEY',
        auth: 'basic',
        headers: { Referer: 'https://example-publisher-site.com/' },
        query: {
          locale_code: 'es_CO',
          keywords: 'desarrollador programador',
          page: '{{page}}',
          page_size: '20',
          // `date` trae lo más reciente primero; con `relevance` se llena de avisos viejos.
          sort: 'date',
          // Obligatorios para Careerjet (si faltan: HTTP 403).
          user_ip: '127.0.0.1',
          user_agent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        itemsPath: 'jobs',
        mapping: {
          title: 'title',
          // Es su enlace de redirección (jobviewtrack.com): el navegador resuelve
          // el aviso real, igual que con Jooble.
          url: 'url',
          company: 'company',
          location: 'locations',
          salary: 'salary',
          postedAt: 'date',
          description: 'description',
        },
      },
    },
    limits: {
      maxPages: 2,
      delayMs: 1500,
      timeoutMs: 20000,
      retryAttempts: 2,
      retryDelayMs: 2000,
      respectRobots: true,
    },
  },
  {
    id: 'jobsdev-fixture',
    label: 'JobsDev Fixture (E2E local)',
    hint: 'http://cvharness-fixture/jobs.html dentro de docker, o localhost:8090/jobs.html nativo',
    baseUrlDefault: 'http://cvharness-fixture',
    selectors: {
      item: '.job-item',
      title: '.job-title a',
      company: '.job-company',
      location: '.job-location',
      postedAt: '.job-date',
      description: '.job-description',
      applyUrl: '.job-title a',
    },
    limits: { maxPages: 1, delayMs: 300, timeoutMs: 15000, respectRobots: false },
  },
];
