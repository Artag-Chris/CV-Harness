import { describe, expect, it } from 'vitest';
import { apiTemplateHint } from '../src/modules/sources/probe/recipe-probe.service';

/**
 * Cuando el portal tiene API oficial, el probe de HTML NO puede funcionar (el WAF
 * responde con challenge siempre). El usuario que pega la URL de Jooble y aprieta
 * «Analizar URL» se quedaba sin salida: el mensaje tiene que nombrar la plantilla.
 */
describe('apiTemplateHint', () => {
  it('manda a la plantilla de API cuando el portal tiene API oficial', () => {
    const hint = apiTemplateHint(
      'https://co.jooble.org/SearchResult?ukw=desarrollador%20y%20programador',
    );
    expect(hint).toMatch(/Jooble \(API oficial\)/);
    expect(hint).toMatch(/Analizar URL/);
  });

  it('reconoce también el host sin país', () => {
    expect(apiTemplateHint('https://jooble.org/SearchResult?ukw=dev')).toMatch(/Jooble/);
  });

  it('no opina sobre portales que sí se raspan con receta', () => {
    expect(
      apiTemplateHint('https://co.computrabajo.com/trabajo-de-desarrollador-y-programador'),
    ).toBeNull();
  });

  it('no explota con una URL inválida', () => {
    expect(apiTemplateHint('no-es-una-url')).toBeNull();
  });

  it('manda a la plantilla de Careerjet cuando el portal es OpcionEmpleo', () => {
    expect(apiTemplateHint('https://www.opcionempleo.com.co/ofertas-trabajo?q=dev')).toMatch(
      /Careerjet/,
    );
  });

  /**
   * Indeed es el caso molesto: su HTML está detrás de Cloudflare con challenge y
   * su API pública está dada de baja, así que la única salida real es un
   * agregador con API oficial. El mensaje tiene que decirlo y nombrarlos.
   */
  it('para Indeed explica que no hay API self-serve y deriva a los agregadores', () => {
    const hint = apiTemplateHint(
      'https://co.indeed.com/jobs?q=desarrollador+y+programador&l=&from=searchOnHP&vjk=14994e110cdbc534',
    );
    expect(hint).toMatch(/Indeed/);
    expect(hint).toMatch(/descontinu/i);
    expect(hint).toMatch(/Jooble/);
    expect(hint).toMatch(/Careerjet/);
  });

  it('reconoce también LinkedIn', () => {
    expect(apiTemplateHint('https://www.linkedin.com/jobs/search/?keywords=dev')).toMatch(
      /LinkedIn/,
    );
  });
});
