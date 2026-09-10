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
