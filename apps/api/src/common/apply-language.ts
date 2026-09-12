/**
 * Idioma de postulación de una HV.
 *
 *  - `auto`: sigue el idioma de la vacante (comportamiento histórico).
 *  - `es` / `en`: fuerza el idioma del CV y de la carta, aunque la vacante esté
 *    en otro idioma.
 *
 * Se guarda en `Profile.applyLanguage` (default del perfil) y, por borrador, en
 * `content.language` (override por HV).
 */
export const APPLY_LANGUAGES = ['auto', 'es', 'en'] as const;
export type ApplyLanguage = (typeof APPLY_LANGUAGES)[number];

export function isApplyLanguage(value: unknown): value is ApplyLanguage {
  return typeof value === 'string' && (APPLY_LANGUAGES as readonly string[]).includes(value);
}

/** Normaliza un valor suelto a un idioma válido (o null si no lo es). */
export function normalizeApplyLanguage(value: unknown): ApplyLanguage | null {
  return isApplyLanguage(value) ? value : null;
}

/**
 * Idioma efectivo de un borrador: manda el idioma guardado en el propio
 * borrador (override por HV); si no hay, el del perfil; si no, `auto`.
 */
export function resolveApplyLanguage(
  draftLanguage: unknown,
  profileLanguage: unknown,
): ApplyLanguage {
  return normalizeApplyLanguage(draftLanguage) ?? normalizeApplyLanguage(profileLanguage) ?? 'auto';
}

/** Regla de idioma que se anexa al prompt del LLM (HV y carta). */
export function languageInstruction(language: ApplyLanguage): string {
  switch (language) {
    case 'es':
      return 'Escribe SIEMPRE en español, aunque la vacante esté en otro idioma.';
    case 'en':
      return 'Escribe SIEMPRE en inglés, aunque la vacante esté en otro idioma.';
    default:
      return 'Escribe en español salvo que la vacante esté en otro idioma (en ese caso, seguí el idioma de la vacante).';
  }
}
