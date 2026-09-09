import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Asegura que la base de datos objetivo exista antes de correr migraciones.
 * Se conecta a la base de mantenimiento "postgres" del MISMO servidor con las
 * credenciales de DATABASE_URL y crea la base del harness si falta.
 *
 * Uso: npx ts-node prisma/ensure-database.ts
 * (lo ejecuta el contenedor api en cada boot, antes de `prisma migrate deploy`).
 */
async function main(): Promise<void> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) throw new Error('DATABASE_URL no está definida');

  const parsed = new URL(targetUrl);
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0] || 'postgres';
  parsed.pathname = '/postgres'; // base de mantenimiento (siempre existe)

  const admin = new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
  try {
    const rows = await admin.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM pg_database WHERE datname = ${dbName}
    `;
    if (rows.length > 0) {
      console.log(`[ensure-db] la base "${dbName}" ya existe — omitido`);
    } else {
      // CREATE DATABASE no corre dentro de una transacción explícita.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[ensure-db] base "${dbName}" creada`);
    }
  } finally {
    await admin.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[ensure-db] falló:', message);
  console.error('');
  console.error('DIAGNÓSTICO (usá la URL que imprime abajo para ver qué host se está usando):');
  console.error(`  DATABASE_URL resuelta: ${process.env.DATABASE_URL ?? '(vacía)'}`);
  if (message.includes('P1001') || message.includes('Can\'t reach') || message.includes('P1003')) {
    console.error('');
    console.error('  Si es el SERVER remoto: el .env debe ser el del server (copiá .env.example → .env).');
    console.error('    DATABASE_HOST=atiende-postgres · POSTGRES_USER=atiende · POSTGRES_PASSWORD=atiende_dev');
    console.error('    y el contenedor atiende-postgres debe estar en la red microservices-network.');
    console.error('  Si es TU MÁQUINA (local): primero levantá la infra y usá el .env local:');
    console.error('    npm run docker:infra:up');
    console.error('    DATABASE_HOST=cvharness-postgres · POSTGRES_USER=cvharness · POSTGRES_PASSWORD=cvharness');
    console.error('  Nunca corras en el server con el .env de tu máquina local (trae cvharness-postgres).');
  }
  process.exit(1);
});
