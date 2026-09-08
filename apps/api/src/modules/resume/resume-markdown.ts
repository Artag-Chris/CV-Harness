/**
 * Renderiza el contenido estructurado de una HV (ResumeContent) a Markdown.
 */
export function renderResumeMarkdown(
  content: ResumeContentLike,
  profileName: string,
): string {
  const out: string[] = [];
  out.push(`# ${profileName}`);
  const meta = [content.headline].filter(Boolean);
  if (meta.length) out.push(`**${meta.join(' · ')}**`);
  out.push('');

  out.push('## Perfil');
  out.push(content.summary || '');
  out.push('');

  if (content.experience.length) {
    out.push('## Experiencia');
    for (const exp of content.experience) {
      out.push(`### ${exp.role} — ${exp.company}`);
      if (exp.period) out.push(`*${exp.period}*`);
      for (const b of exp.bullets) out.push(`- ${b}`);
      out.push('');
    }
  }

  if (content.projects.length) {
    out.push('## Proyectos destacados');
    for (const p of content.projects) {
      out.push(`### ${p.name}`);
      for (const h of p.highlights) out.push(`- ${h}`);
      out.push('');
    }
  }

  if (content.skills.length) {
    out.push('## Habilidades');
    out.push(content.skills.join(', '));
    out.push('');
  }

  if (content.education.length) {
    out.push('## Educación');
    for (const edu of content.education) {
      const period = edu.period ? ` (${edu.period})` : '';
      out.push(`- ${edu.degree} — ${edu.institution}${period}`);
    }
    out.push('');
  }

  if (content.softSkills.length) {
    out.push('## Soft skills');
    out.push(content.softSkills.join(' · '));
    out.push('');
  }

  return out.join('\n');
}

export interface ResumeContentLike {
  headline: string;
  summary: string;
  skills: string[];
  experience: { role: string; company: string; period: string; bullets: string[] }[];
  projects: { name: string; highlights: string[] }[];
  education: { institution: string; degree: string; period: string }[];
  softSkills: string[];
  keywords?: string[];
}
