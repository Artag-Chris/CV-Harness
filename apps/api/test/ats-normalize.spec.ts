import { describe, expect, it } from 'vitest';
import {
  compactToken,
  normalizeForAts,
  significantTokens,
  tokenize,
} from '../src/modules/ats/normalize';
import { synonymVariants, tokenMatches } from '../src/modules/ats/synonyms';

/**
 * Normalización del medidor de ATS. Sin esto, "Inglés" no matchea "english" y
 * "Node.js" no matchea "nodejs": el score daría faltantes que sí están.
 */
describe('normalizeForAts', () => {
  it('baja a minúsculas y quita acentos', () => {
    expect(normalizeForAts('Inglés AVANZADO')).toBe('ingles avanzado');
    expect(normalizeForAts('EDUCACIÓN')).toBe('educacion');
  });

  it('conserva los caracteres significativos de tecnología', () => {
    expect(normalizeForAts('Node.js')).toBe('node.js');
    expect(normalizeForAts('CI/CD')).toBe('ci/cd');
    expect(normalizeForAts('C++')).toBe('c++');
    expect(normalizeForAts('C#')).toBe('c#');
  });

  it('colapsa la puntuación que no aporta', () => {
    expect(normalizeForAts('React, Node.js y Express.')).toBe('react node.js y express');
  });
});

describe('tokenize / compactToken', () => {
  it('separa en tokens', () => {
    expect(tokenize('React y Node.js')).toEqual(['react', 'y', 'node.js']);
  });

  it('compacta los separadores internos', () => {
    expect(compactToken('node.js')).toBe('nodejs');
    expect(compactToken('ci/cd')).toBe('cicd');
  });
});

describe('significantTokens', () => {
  it('descarta palabras genéricas de requisito', () => {
    // Lo importante del requisito son las tecnologías, no "experiencia con".
    expect(significantTokens('1+ year of experience with React and Node.js')).toEqual([
      'react',
      'node.js',
    ]);
  });

  it('conserva el idioma como señal (es un requisito duro)', () => {
    expect(significantTokens('Advanced level of English')).toEqual(['english']);
    expect(significantTokens('Inglés B2')).toEqual(['ingles', 'b2']);
  });

  it('descarta el seniority', () => {
    expect(significantTokens('Junior Fullstack Developer')).toEqual(['fullstack', 'developer']);
  });
});

describe('sinónimos', () => {
  it('equipara node y nodejs', () => {
    expect(tokenMatches('node', 'nodejs')).toBe(true);
    expect(tokenMatches('nodejs', 'node.js')).toBe(true);
  });

  it('equipara postgres y postgresql', () => {
    expect(tokenMatches('postgresql', 'postgres')).toBe(true);
  });

  it('expone los alias de una frase para el match por frase', () => {
    expect(synonymVariants('fullstack')).toContain('full stack');
  });

  it('no inventa equivalencias entre términos distintos', () => {
    expect(tokenMatches('react', 'angular')).toBe(false);
    expect(tokenMatches('rest', 'rust')).toBe(false);
  });
});
