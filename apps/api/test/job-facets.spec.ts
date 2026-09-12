import { describe, expect, it } from 'vitest';
import {
  canonicalModalities,
  canonicalSeniority,
  isModalityType,
  isSeniorityLevel,
  parseModalities,
  parseSeniorities,
} from '../src/common/job-facets';

describe('canonicalModalities', () => {
  it('reconoce las tres modalidades en español', () => {
    expect(canonicalModalities('Remoto')).toEqual(['REMOTE']);
    expect(canonicalModalities('Híbrido')).toEqual(['HYBRID']);
    expect(canonicalModalities('Presencial')).toEqual(['ONSITE']);
  });

  it('reconoce también el texto en inglés y variantes reales de portales', () => {
    expect(canonicalModalities('Fully Remote')).toEqual(['REMOTE']);
    expect(canonicalModalities('100% remoto (home office)')).toEqual(['REMOTE']);
    expect(canonicalModalities('Hybrid work')).toEqual(['HYBRID']);
    expect(canonicalModalities('On-site')).toEqual(['ONSITE']);
    expect(canonicalModalities('Trabajo en modalidad mixta')).toEqual(['HYBRID']);
  });

  it('una vacante que ofrece varias modalidades devuelve todas', () => {
    expect(canonicalModalities('Híbrido / Remoto')).toEqual(['REMOTE', 'HYBRID']);
  });

  it('ignora acentos y mayúsculas', () => {
    expect(canonicalModalities('HÍBRIDO')).toEqual(['HYBRID']);
    expect(canonicalModalities('hibrido')).toEqual(['HYBRID']);
  });

  it('sin texto no inventa modalidad', () => {
    expect(canonicalModalities(null, undefined, '')).toEqual([]);
    expect(canonicalModalities('Empresa líder del sector')).toEqual([]);
  });

  it('combina varios campos (scrape + extracción del LLM)', () => {
    expect(canonicalModalities(null, 'Presencial')).toEqual(['ONSITE']);
    expect(canonicalModalities('Remoto', 'Híbrido')).toEqual(['REMOTE', 'HYBRID']);
  });
});

describe('canonicalSeniority', () => {
  it('clasifica las bandas habituales', () => {
    expect(canonicalSeniority('Junior')).toBe('JUNIOR');
    expect(canonicalSeniority('Senior')).toBe('SENIOR');
    expect(canonicalSeniority('Tech Lead')).toBe('LEAD');
    expect(canonicalSeniority('Practicante')).toBe('TRAINEE');
  });

  it('NO confunde "Semi Senior" con "Senior" (bug del extractor determinístico)', () => {
    expect(canonicalSeniority('Semi Senior')).toBe('SEMI_SENIOR');
    expect(canonicalSeniority('Semisenior Backend')).toBe('SEMI_SENIOR');
    expect(canonicalSeniority('SSR Node.js')).toBe('SEMI_SENIOR');
  });

  it('acepta abreviaturas y acentos', () => {
    expect(canonicalSeniority('Sr. Backend Engineer')).toBe('SENIOR');
    expect(canonicalSeniority('líder técnico')).toBe('LEAD');
  });

  it('sin señal devuelve null (no adivina)', () => {
    expect(canonicalSeniority('Desarrollador Backend')).toBeNull();
    expect(canonicalSeniority(null)).toBeNull();
  });
});

describe('parseo de query params (filtros)', () => {
  it('parseModalities acepta CSV, normaliza y descarta valores inválidos', () => {
    expect(parseModalities('REMOTE, hybrid ,basura')).toEqual(['REMOTE', 'HYBRID']);
    expect(parseModalities(null)).toEqual([]);
  });

  it('parseSeniorities acepta CSV y descarta valores inválidos', () => {
    expect(parseSeniorities('senior,junior,xyz')).toEqual(['SENIOR', 'JUNIOR']);
  });

  it('los guards validan contra el catálogo canónico', () => {
    expect(isModalityType('REMOTE')).toBe(true);
    expect(isModalityType('remoto')).toBe(false);
    expect(isSeniorityLevel('SEMI_SENIOR')).toBe(true);
    expect(isSeniorityLevel('SEMI SENIOR')).toBe(false);
  });
});
