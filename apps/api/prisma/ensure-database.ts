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
  console.error('[ensure-db] falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
