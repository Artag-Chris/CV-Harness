import type { AtsContent } from './analyzer';

/**
 * Recorta el contenido del borrador a las secciones de redacción de la HV.
 * Se excluye a propósito lo que no es CV (`markdown`, carta, `atsMode`) para no
 * confundir a la IA con ruido ni dejar que pise esos campos al responder.
 */
export function toResumePayload(content: AtsContent): Record<string, unknown> {
  return {
    headline: content.headline ?? '',
    summary: content.summary ?? '',
    skills: content.skills ?? [],
    experience: content.experience ?? [],
    projects: content.projects ?? [],
    education: content.education ?? [],
    softSkills: content.softSkills ?? [],
    keywords: content.keywords ?? [],
  };
}
