import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { profileSeed } from './seed/profiles.data';
import { sourceSeeds } from './seed/sources.data';

const prisma = new PrismaClient();

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@cvharness.local';
  const password = process.env.ADMIN_PASSWORD ?? 'admin1234';
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] admin ${email} ya existe — omitido`);
    return;
  }
  await prisma.adminUser.create({
    data: { email, passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`[seed] admin creado: ${email}`);
}

async function seedSkills() {
  // Indexa los skills del perfil para upsertear entidades Skill.
  const names = new Set(profileSeed.skills.map((s) => s.name));
  for (const name of names) {
    await prisma.skill.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`[seed] ${names.size} skills asegurados`);
}

async function seedProfile() {
  const existing = await prisma.profile.findFirst({
    where: { email: profileSeed.email },
  });
  if (existing) {
    console.log(`[seed] perfil ${profileSeed.email} ya existe — omitido`);
    return;
  }

  const skillsByName = new Map(
    (await prisma.skill.findMany()).map((s) => [s.name, s.id]),
  );

  const data: Prisma.ProfileCreateInput = {
    name: profileSeed.name,
    headline: profileSeed.headline,
    summary: profileSeed.summary,
    email: profileSeed.email,
    phone: profileSeed.phone,
    location: profileSeed.location,
    languages: profileSeed.languages,
    softSkills: profileSeed.softSkills,
    isPrimary: true,
    links: {
      create: profileSeed.links,
    },
    experiences: {
      create: profileSeed.experiences.map((e) => ({
        role: e.role,
        company: e.company,
        periodStart: e.periodStart,
        periodEnd: e.periodEnd,
        isCurrent: e.isCurrent ?? false,
        bullets: e.bullets,
      })),
    },
    education: {
      create: profileSeed.education,
    },
    projects: {
      create: profileSeed.projects.map((p) => ({
        name: p.name,
        summary: p.summary,
        stack: p.stack,
        repositoryUrl: p.repositoryUrl,
        websiteUrl: p.websiteUrl,
        visibility: p.visibility,
        highlights: p.highlights,
      })),
    },
    skills: {
      create: profileSeed.skills.map((s) => ({
        category: s.category,
        rating: s.rating,
        provenance: 'curated',
        knowledge: s.knowledge ?? null,
        skill: { connect: { id: skillsByName.get(s.name)! } },
      })),
    },
  };

  await prisma.profile.create({ data });
  console.log(`[seed] perfil creado: ${profileSeed.name} (${profileSeed.skills.length} skills)`);
}

async function seedSources() {
  const { FIXTURE_BASE_URL, FIXTURE_ENABLED } = process.env;
  const fixtureEnabled = (FIXTURE_ENABLED ?? 'true') !== 'false';
  for (const src of sourceSeeds) {
    // La fixture apunta a localhost:8090 fijo; si FIXTURE_BASE_URL cambió, se ajusta.
    const listUrl = src.listUrl.replace('http://localhost:8090', FIXTURE_BASE_URL ?? 'http://localhost:8090');
    const baseUrl = src.baseUrl.replace('http://localhost:8090', FIXTURE_BASE_URL ?? 'http://localhost:8090');
    // La fuente E2E se crea habilitada solo si FIXTURE_ENABLED=true.
    const enabled = src.matchKey === 'JobsDev' ? fixtureEnabled : src.enabled;
    const data = {
      name: src.name,
      kind: src.kind,
      baseUrl,
      listUrl,
      selectors: src.selectors as unknown as Prisma.InputJsonValue,
      limits: src.limits as unknown as Prisma.InputJsonValue,
      enabled,
      intervalMinutes: src.intervalMinutes,
    };
    const existing = await prisma.source.findFirst({
      where: { OR: [{ listUrl }, { name: { startsWith: src.matchKey } }] },
    });
    if (existing) {
      // Autorreparación: reescribe la receta built-in. Los selectores de los
      // portales se rompen con los rediseños; así el arranque los corrige.
      await prisma.source.update({ where: { id: existing.id }, data });
      console.log(`[seed] fuente "${src.name}" actualizada (receta)`);
      continue;
    }
    await prisma.source.create({ data });
    console.log(`[seed] fuente creada: ${src.name}${enabled ? '' : ' (deshabilitada)'}`);
  }
}

async function main() {
  await seedAdminUser();
  await seedSkills();
  await seedProfile();
  await seedSources();
  console.log('[seed] listo ✓');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
