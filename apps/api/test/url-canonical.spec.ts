import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '../src/common/url.util';

/**
 * La URL canónica es la que deduplica: mismo aviso ⇒ misma cadena. Sin esto,
 * `?utm_…`, un fragmento, `http` vs `https`, `www` o la barra final creaban una
 * fila nueva por el mismo aviso.
 */
describe('canonicalizeUrl', () => {
  it('quita parámetros de tracking', () => {
    expect(canonicalizeUrl('https://x.com/job/1?utm_source=li&utm_campaign=a&gclid=z')).toBe(
      'https://x.com/job/1',
    );
  });

  it('conserva los parámetros significativos (no borra el id del aviso)', () => {
    expect(canonicalizeUrl('https://co.indeed.com/viewjob?jk=1a2b3c&from=alert')).toBe(
      'https://co.indeed.com/viewjob?from=alert&jk=1a2b3c',
    );
  });

  it('ordena los parámetros para que el orden no cree un duplicado', () => {
    expect(canonicalizeUrl('https://x.com/j?b=2&a=1')).toBe('https://x.com/j?a=1&b=2');
  });

  it('normaliza host, www, esquema y barra final', () => {
    expect(canonicalizeUrl('HTTP://WWW.Example.com/job/1/')).toBe('http://example.com/job/1');
    expect(canonicalizeUrl('https://www.example.com/')).toBe('https://example.com/');
  });

  it('quita el fragmento', () => {
    expect(canonicalizeUrl('https://x.com/job/1#lc=abc')).toBe('https://x.com/job/1');
  });

  it('descarta el puerto por defecto', () => {
    expect(canonicalizeUrl('https://x.com:443/job/1')).toBe('https://x.com/job/1');
  });

  it('avisos distintos del mismo portal siguen siendo distintos', () => {
    expect(canonicalizeUrl('https://co.indeed.com/viewjob?jk=AAA')).not.toBe(
      canonicalizeUrl('https://co.indeed.com/viewjob?jk=BBB'),
    );
  });

  it('un valor no parseable se devuelve recortado y la cadena vacía queda vacía', () => {
    expect(canonicalizeUrl('  no-es-una-url  ')).toBe('no-es-una-url');
    expect(canonicalizeUrl('')).toBe('');
  });
});
