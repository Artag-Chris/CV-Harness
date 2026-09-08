import { PrismaService } from '../../common/prisma.service';

/**
 * Serializa el perfil canónico (con todas sus relaciones) a texto estructurado
 * para usarlo como contexto del LLM en matching y redacción de HV.
 */
export async function buildProfileSnapshot(
  prisma: PrismaService,
  profileId?: string | null,
): Promise<string> {
  const profile = await prisma.profile.findFirst({
    where: profileId ? { id: profileId } : { isPrimary: true },
    include: {
      links: true,
      experiences: { orderBy: { sortOrder: 'asc' } },
      education: { orderBy: { sortOrder: 'asc' } },
      projects: true,
      skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
    },
  });
  if (!profile) throw new Error('No hay perfil canónico sembrado (corre prisma seed)');

  const lines: string[] = [];
  lines.push('PERFIL CANÓNICO DEL CANDIDATO');
  lines.push(`Nombre: ${profile.name}`);
  lines.push(`Títulos: ${profile.headline.join(', ')}`);
  if (profile.location) lines.push(`Ubicación: ${profile.location}`);
  const langs = (profile.languages as { language: string; level: string }[] ?? [])
    .map((l) => `${l.language} (${l.level})`)
    .join(', ');
  if (langs) lines.push(`Idiomas: ${langs}`);
  const contact = profile.links.map((l) => `${l.type}: ${l.url}`).join(' | ');
  if (contact) lines.push(`Contacto: ${contact}`);

  lines.push('', 'Resumen:', profile.summary);

  const byCategory = new Map<string, string[]>();
  for (const ps of profile.skills) {
    const entry = `${ps.skill.name} (${ps.rating}/5)`;
    const list = byCategory.get(ps.category) ?? [];
    list.push(entry);
    byCategory.set(ps.category, list);
  }
  lines.push('', 'Habilidades (categoría → skill con nivel):');
  for (const [category, skills] of byCategory) {
    lines.push(`- ${category}: ${skills.join(', ')}`);
  }

  lines.push('', 'Experiencia:');
  for (const exp of profile.experiences) {
    const period = exp.periodEnd
      ? `${exp.periodStart} – ${exp.periodEnd}`
      : exp.periodStart;
    lines.push(`- ${exp.role} — ${exp.company} (${period})`);
    for (const bullet of (exp.bullets as string[]) ?? []) {
      lines.push(`  • ${bullet}`);
    }
  }

  lines.push('', 'Proyectos:');
  for (const proj of profile.projects) {
    const stack = (proj.stack as string[] ?? []).join(', ');
    lines.push(`- ${proj.name} [${stack}]${proj.repositoryUrl ? ` — ${proj.repositoryUrl}` : ''}`);
    for (const highlight of (proj.highlights as string[] ?? []).slice(0, 4)) {
      lines.push(`  • ${highlight}`);
    }
  }

  lines.push('', 'Educación:');
  for (const edu of profile.education) {
    const period = edu.periodEnd
      ? `${edu.periodStart} – ${edu.periodEnd}`
      : edu.periodStart;
    lines.push(`- ${edu.degree} — ${edu.institution} (${period})`);
  }

  const soft = (profile.softSkills as string[] ?? []).slice(0, 6);
  if (soft.length > 0) {
    lines.push('', 'Soft skills:', soft.map((s) => `- ${s}`).join('\n'));
  }

  return lines.join('\n');
}
