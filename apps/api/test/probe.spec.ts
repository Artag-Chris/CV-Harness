import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { extractWithRecipe, scoreRecipe } from '../src/modules/sources/probe/extract';
import { detectRecipe } from '../src/modules/sources/probe/heuristic';
import { isLikelyValidCss } from '../src/modules/sources/probe/fetch';
import { SourcesService } from '../src/modules/sources/sources.service';

const BASE = 'https://ejemplo.com';

/** Listado con 6 tarjetas repetidas (el caso típico de un portal de empleo). */
function listing(count = 6): string {
  const cards = Array.from({ length: count }, (_, i) => `
    <div class="job-card mb-3">
      <h3 class="job-card-title"><a class="job-link" href="/empleo/dev-${i}">Desarrollador ${i}</a></h3>
      <span class="company-name">Empresa ${i}</span>
      <span class="job-city">Bogotá</span>
      <span class="job-salary">$ ${i}.000.000</span>
      <span class="job-post-date">Hace ${i} días</span>
      <p class="job-summary">Buscamos desarrollador ${i} con experiencia.</p>
    </div>`).join('');
  return `<!DOCTYPE html><html><body><div class="results">${cards}</div></body></html>`;
}

describe('extractWithRecipe', () => {
  it('extrae los items y absolutiza la URL sin fragmento', () => {
    const html = listing(3);
    const { items } = extractWithRecipe(
      html,
      { item: '.job-card', title: '.job-card-title a', applyUrl: '.job-link' },
      BASE,
    );
    expect(items).toHaveLength(3);
    expect(items[0].title).toBe('Desarrollador 0');
    expect(items[0].url).toBe('https://ejemplo.com/empleo/dev-0');
  });

  it('sin selector item no explota: devuelve vacío', () => {
    const { items } = extractWithRecipe(listing(3), {}, BASE);
    expect(items).toEqual([]);
  });

  it('un selector CSS inválido no rompe la validación', () => {
    const { items } = extractWithRecipe(listing(3), { item: 'div:::mal' }, BASE);
    expect(items).toEqual([]);
  });

  it('scoreRecipe vale 0 sin títulos', () => {
    expect(scoreRecipe(listing(4), { item: '.no-existe' }, BASE)).toBe(0);
  });
});

describe('detectRecipe (heurística)', () => {
  it('detecta la tarjeta y el título sin ayuda de la IA', () => {
    const result = detectRecipe(listing(6), BASE);
    expect(result.selectors).not.toBeNull();
    expect(result.itemCount).toBe(6);
    // El título debe resolver a un enlace con texto.
    expect(result.selectors?.title).toBeTruthy();
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('propone empresa, ciudad, salario y fecha por nombre de clase', () => {
    const result = detectRecipe(listing(6), BASE);
    const s = result.selectors ?? {};
    expect(s.company).toContain('company');
    expect(s.location).toContain('city');
    expect(s.salary).toContain('salary');
    expect(s.postedAt).toContain('date');
  });

  it('la receta detectada realmente extrae items útiles', () => {
    const html = listing(6);
    const { selectors } = detectRecipe(html, BASE);
    const { items } = extractWithRecipe(html, selectors ?? {}, BASE);
    expect(items.filter((i) => i.title).length).toBe(6);
    expect(items.filter((i) => i.company).length).toBe(6);
  });

  it('devuelve null si la página no es un listado', () => {
    const result = detectRecipe('<html><body><p>Hola</p></body></html>', BASE);
    expect(result.selectors).toBeNull();
  });

  /**
   * Caso real (elempleo): el pie de página tiene ~84 enlaces cortos a ciudades
   * ("Trabajo en Abrego"), más que las 20 vacantes reales. La heurística no debe
   * confundir esa lista de navegación con el listado de empleos.
   */
  it('no confunde una lista de navegación con el listado de vacantes', () => {
    const navLinks = Array.from(
      { length: 84 },
      (_, i) => `<li class="ee_list-item"><a class="ee_list-item-text" href="/empleo/ciudad-${i}">Trabajo en Ciudad ${i}</a></li>`,
    ).join('');
    const html = `<!DOCTYPE html><html><body>
      ${listing(20)}
      <footer><ul class="ee_city-list">${navLinks}</ul></footer>
    </body></html>`;

    const result = detectRecipe(html, BASE);
    expect(result.itemCount).toBe(20);
    // Apunta a la tarjeta de vacante, no a la lista de ciudades del pie.
    expect(result.selectors?.item).toContain('job-card');
    expect(result.selectors?.item).not.toContain('ee_');
  });

  /**
   * Casos reales (elempleo): el salario no trae pista en la clase (hay que
   * detectarlo por el importe) y las etiquetas ocultas no deben ganar campos.
   */
  it('detecta el salario por el importe y evita etiquetas ocultas', () => {
    const cards = Array.from({ length: 6 }, (_, i) => `
      <div class="vacancy">
        <a class="offer-title" href="/oferta/${i}">Puesto ${i}</a>
        <span class="info-company-name">Empresa ${i}</span>
        <span class="hide">COP</span>
        <span class="text-blue-petrol-dark">${i === 0 ? 'Salario confidencial' : `$ ${i},5 millones`}</span>
      </div>`).join('');
    const result = detectRecipe(`<html><body>${cards}</body></html>`, BASE);

    expect(result.selectors?.salary).toContain('text-blue-petrol-dark');
    expect(result.selectors?.company).toContain('info-company-name');
    // La etiqueta oculta "COP" nunca debe elegirse como salario.
    expect(result.selectors?.salary).not.toContain('hide');
  });
});

describe('isLikelyValidCss', () => {
  it('acepta CSS estándar', () => {
    expect(isLikelyValidCss('article.box_offer')).toBe(true);
    expect(isLikelyValidCss('p.fs16:not(.dFlex) span.mr10')).toBe(true);
    expect(isLikelyValidCss('[title="Siguiente"]')).toBe(true);
  });

  it('rechaza sintaxis de Playwright/jQuery/XPath que Rust no entiende', () => {
    expect(isLikelyValidCss('a:has-text("Siguiente")')).toBe(false);
    expect(isLikelyValidCss('a:contains("x")')).toBe(false);
    expect(isLikelyValidCss('xpath=//a')).toBe(false);
    expect(isLikelyValidCss('div >> span')).toBe(false);
  });

  it('rechaza comillas desbalanceadas', () => {
    expect(isLikelyValidCss('a[title="Siguiente]')).toBe(false);
  });
});

describe('SourcesService.remove', () => {
  function serviceWith(vacancies: number) {
    const calls: string[] = [];
    const prisma = {
      source: {
        findUnique: () => Promise.resolve({ id: 's1', _count: { vacancies } }),
        delete: () => {
          calls.push('delete');
          return Promise.resolve({ id: 's1' });
        },
      },
    };
    return { service: new SourcesService(prisma as never), calls };
  }

  it('se niega a borrar si tiene vacantes y no hay force', async () => {
    const { service, calls } = serviceWith(12);
    await expect(service.remove('s1')).rejects.toThrow(/12 vacantes/);
    expect(calls).toEqual([]);
  });

  it('borra en cascada con force y reporta cuántas vacantes se fueron', async () => {
    const { service, calls } = serviceWith(12);
    await expect(service.remove('s1', true)).resolves.toEqual({ deletedVacancies: 12 });
    expect(calls).toEqual(['delete']);
  });

  it('borra sin force si la fuente no tiene vacantes', async () => {
    const { service } = serviceWith(0);
    await expect(service.remove('s1')).resolves.toEqual({ deletedVacancies: 0 });
  });

  it('rechaza una URL inválida en create (validación antes de la BD)', async () => {
    const { service } = serviceWith(0);
    await expect(service.create({ name: 'x', listUrl: 'no-es-url' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
