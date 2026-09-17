import { Injectable } from '@nestjs/common';
import { buildDupKey } from '../../common/dup-key';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { canonicalizeUrl } from '../../common/url.util';

/** Filas por lote: acota el trabajo por corrida (idempotente, se reanuda solo). */
const BACKFILL_BATCH = 500;
const CANDIDATE_BATCH = 2000;

export interface DedupSummary {
  backfilled: number;
  marked: number;
}

/**
 * Detector de duplicados que se escaparon del dedup de la ingesta: mismo aviso
 * con distinta URL (parámetros, portal de origen…) o cargado antes de que
 * existieran `canonicalUrl`/`dupKey`.
 *
 * No borra nada: marca `duplicateOfId` apuntando al aviso canónico. El listado
 * los oculta por defecto y el usuario puede revertir con «No es duplicado».
 */
@Injectable()
export class DedupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: JsonLogger,
  ) {}

  async run(): Promise<DedupSummary> {
    const backfilled = await this.backfill();
    const marked = await this.markDuplicates();
    const summary = { backfilled, marked };
    this.logger.log({ msg: 'pase de dedup', ...summary }, DedupService.name);
    return summary;
  }

  /** Rellena `canonicalUrl`/`dupKey` de las filas viejas (mismas funciones que runtime). */
  async backfill(): Promise<number> {
    const rows = await this.prisma.vacancy.findMany({
      where: { OR: [{ canonicalUrl: null }, { dupKey: null }] },
      select: { id: true, url: true, title: true, company: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: BACKFILL_BATCH,
    });
    if (rows.length === 0) return 0;

    for (const row of rows) {
      await this.prisma.vacancy.update({
        where: { id: row.id },
        data: {
          // '' (no null) marca «ya evaluado»: si no, un aviso sin URL o sin
          // empresa se vuelve a leer en cada pase para siempre.
          canonicalUrl: canonicalizeUrl(row.url) || '',
          dupKey: buildDupKey(row) ?? '',
        },
      });
    }
    return rows.length;
  }

  /** Agrupa por `dupKey` y marca como duplicado todo lo que no sea el canónico. */
  async markDuplicates(): Promise<number> {
    const rows = await this.prisma.vacancy.findMany({
      where: { duplicateOfId: null, dupDismissed: false },
      select: { id: true, dupKey: true },
      orderBy: { createdAt: 'asc' },
      take: CANDIDATE_BATCH,
    });

    const groups = new Map<string, string[]>();
    for (const row of rows) {
      // '' = sin empresa/imposible de calcular: no agrupa.
      if (!row.dupKey) continue;
      const list = groups.get(row.dupKey) ?? [];
      list.push(row.id);
      groups.set(row.dupKey, list);
    }

    let marked = 0;
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      // `rows` viene ordenado por createdAt asc → el primero es el más viejo.
      const [canonical, ...rest] = ids;
      for (const id of rest) {
        await this.prisma.vacancy.update({
          where: { id },
          data: { duplicateOfId: canonical },
        });
        marked += 1;
      }
    }
    return marked;
  }
}
