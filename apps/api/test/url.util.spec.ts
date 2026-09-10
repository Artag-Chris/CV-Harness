import { describe, expect, it } from 'vitest';
import { originOf } from '../src/common/url.util';

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
