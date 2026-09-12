import { describe, expect, it } from 'vitest';
import { absoluteUrl, extractJobUrl, hasScheme, originOf } from '../src/common/url.util';

describe('originOf', () => {
  it('extrae el origen de una URL del listado', () => {
    expect(originOf('https://www.elempleo.com/co/ofertas-empleo/dev')).toBe(
      'https://www.elempleo.com',
    );
  });

  it('conserva puerto y esquema', () => {
    expect(originOf('http://localhost:3100/jobs?p=2')).toBe('http://localhost:3100');
  });

  it('devuelve vacío si no es una URL válida', () => {
    expect(originOf('')).toBe('');
    expect(originOf('no-es-url')).toBe('');
    expect(originOf(null)).toBe('');
  });
});

describe('absoluteUrl / hasScheme', () => {
  it('resuelve un href relativo contra el portal', () => {
    expect(absoluteUrl('https://co.computrabajo.com', '/ofertas-trabajo/x')).toBe(
      'https://co.computrabajo.com/ofertas-trabajo/x',
    );
  });

  it('sin base deja la URL absoluta intacta y el relativo igual', () => {
    expect(absoluteUrl('', 'https://x.com/a')).toBe('https://x.com/a');
    expect(absoluteUrl('', '/a')).toBe('/a');
  });

  it('distingue una URL con esquema de un href relativo', () => {
    expect(hasScheme('https://x.com/a')).toBe(true);
    expect(hasScheme('/a')).toBe(false);
    expect(hasScheme('')).toBe(false);
  });
});

/**
 * Avisos que llegan por correo (alertas de Indeed): el link del aviso viene
 * dentro del texto, junto con links de baja y legales que NO son la oferta.
 */
describe('extractJobUrl', () => {
  const ALERT_EMAIL = `Nuevos empleos para: desarrollador programador

Desarrollador Full Stack - ACME SAS - Bogotá
Ver el empleo: https://co.indeed.com/viewjob?jk=1a2b3c&from=alert

Administrar tus alertas: https://co.indeed.com/preferences?tk=xyz
Cancelar la suscripción: https://subscriptions.indeed.com/unsubscribe?email=x`;

  it('toma el link del aviso, no el de baja ni el de preferencias', () => {
    expect(extractJobUrl(ALERT_EMAIL)).toBe('https://co.indeed.com/viewjob?jk=1a2b3c&from=alert');
  });

  it('decodifica `&amp;` de un pegado en HTML', () => {
    expect(
      extractJobUrl('<a href="https://co.indeed.com/viewjob?jk=9&amp;from=serp">Ver</a>'),
    ).toBe('https://co.indeed.com/viewjob?jk=9&from=serp');
  });

  it('sirve para portales, no solo Indeed', () => {
    expect(
      extractJobUrl('Mirá: https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-dev-ABC123'),
    ).toBe('https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-dev-ABC123');
  });

  it('sin URLs devuelve null', () => {
    expect(extractJobUrl('Texto sin links')).toBeNull();
    expect(extractJobUrl(null)).toBeNull();
  });
});
