import { describe, expect, it } from 'vitest';
import {
  isApplyLanguage,
  languageInstruction,
  normalizeApplyLanguage,
  resolveApplyLanguage,
} from '../src/common/apply-language';

describe('apply-language', () => {
  it('reconoce solo los idiomas soportados', () => {
    expect(isApplyLanguage('auto')).toBe(true);
    expect(isApplyLanguage('es')).toBe(true);
    expect(isApplyLanguage('en')).toBe(true);
    expect(isApplyLanguage('fr')).toBe(false);
    expect(isApplyLanguage(null)).toBe(false);
    expect(normalizeApplyLanguage('EN')).toBeNull(); // case-sensitive a propósito
    expect(normalizeApplyLanguage('en')).toBe('en');
  });

  it('el override del borrador manda sobre el default del perfil', () => {
    expect(resolveApplyLanguage('en', 'es')).toBe('en');
    expect(resolveApplyLanguage('auto', 'en')).toBe('auto');
  });

  it('cae al perfil y luego a auto', () => {
    expect(resolveApplyLanguage(undefined, 'en')).toBe('en');
    expect(resolveApplyLanguage(null, null)).toBe('auto');
    // Un valor inválido guardado no debe romper: se ignora.
    expect(resolveApplyLanguage('basura', 'es')).toBe('es');
    expect(resolveApplyLanguage('basura', 'basura')).toBe('auto');
  });

  it('la instrucción de idioma fuerza es/en y en auto sigue a la vacante', () => {
    expect(languageInstruction('es')).toMatch(/SIEMPRE en español/i);
    expect(languageInstruction('en')).toMatch(/SIEMPRE en inglés/i);
    expect(languageInstruction('auto')).toMatch(/idioma de la vacante/i);
  });
});
