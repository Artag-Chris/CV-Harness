import { describe, expect, it } from 'vitest';
import { buildDupKey, normalizeDupText } from '../src/common/dup-key';

/** Clave de contenido: detecta el mismo aviso publicado en otro portal. */
describe('buildDupKey', () => {
  it('normaliza acentos, mayúsculas y puntuación', () => {
    expect(
      buildDupKey({ title: 'Backend Developer Sr.', company: 'ACME, Inc.', location: 'Bogotá' }),
    ).toBe(buildDupKey({ title: 'backend developer sr', company: 'acme inc', location: 'BOGOTA' }));
  });

  it('sin empresa devuelve null (un título suelto agruparía avisos distintos)', () => {
    expect(buildDupKey({ title: 'Desarrollador', company: null, location: 'Remoto' })).toBeNull();
    expect(buildDupKey({ title: 'Desarrollador', company: '   ', location: null })).toBeNull();
  });

  it('títulos distintos no colisionan', () => {
    expect(buildDupKey({ title: 'A', company: 'C' })).not.toBe(
      buildDupKey({ title: 'B', company: 'C' }),
    );
  });
});

describe('normalizeDupText', () => {
  it('quita diacríticos y colapsa espacios', () => {
    expect(normalizeDupText('  Diseñador   Gráfico ')).toBe('disenador grafico');
  });
});
