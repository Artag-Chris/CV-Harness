import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { VacancyStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { fingerprint, fingerprintText } from '../../common/hash.util';
import { PrismaService } from '../../common/prisma.service';
import { cleanDescription } from '../../common/text.util';
import { queueName, QUEUES } from '../../config/queue.config';

/** Mínimo de texto para considerar que es una oferta y no un pegado a medias. */
const MIN_TEXT_LENGTH = 80;

const EMPTY_TEXT_MESSAGE = `Pegá el texto de la oferta (al menos ${MIN_TEXT_LENGTH} caracteres).`;

export interface ManualIntakeInput {
  text: string;
  profileId?: string | null;
  title?: string | null;
  company?: string | null;
  url?: string | null;
}

export interface ManualIntakeResult {
  vacancyId: string;
  /** true si ya existía una vacante con la misma huella (no se duplicó). */
  reused: boolean;
  profileId: string;
}

/**
 * Intake de ofertas pegadas a mano (LinkedIn, BairesDev…): esos sitios no se
 * pueden scrapear, así que el texto entra por acá y se engancha al MISMO
 * pipeline (normalize → match → resume).
 *
 * No existe una "fuente" para esto, y `Vacancy.sourceId` es obligatorio, así que
 * se usa una `Source` sintética (`kind: 'MANUAL'`) deshabilitada: el scheduler
 * solo despacha fuentes `enabled`, y la UI la oculta.
 */
@Injectable()
export class ManualIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(queueName(QUEUES.NORMALIZE)) private readonly normalizeQueue: Queue,
    @InjectQueue(queueName(QUEUES.MATCH)) private readonly matchQueue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async createFromText(input: ManualIntakeInput): Promise<ManualIntakeResult> {
    const cleaned = cleanDescription(input.text ?? '');
    if (cleaned.length < MIN_TEXT_LENGTH) {
      throw new BadRequestException(EMPTY_TEXT_MESSAGE);
    }

    const profileId = await this.resolveProfileId(input.profileId);
    const sourceId = await this.manualSourceId();

    const url = (input.url ?? '').trim();
    // Con URL se deduplica igual que el scraping (sha256 de la URL); sin URL, por
    // el texto, para que pegar dos veces la misma oferta no cree otra vacante.
    const fp = url ? fingerprint(url) : fingerprintText(cleaned);

    const existing = await this.prisma.vacancy.findUnique({ where: { fingerprint: fp } });
    if (existing) {
      // Puede existir para otro perfil: garantizar el match de este.
      await this.ensureMatch(existing.id, profileId);
      this.logger.log(
        { msg: 'oferta pegada ya existía', vacancyId: existing.id, profileId },
        ManualIntakeService.name,
      );
      return { vacancyId: existing.id, reused: true, profileId };
    }

    const vacancy = await this.prisma.vacancy.create({
      data: {
        sourceId,
        // Vacante "dirigida": el fan-out del normalizer respeta este perfil en
        // vez de repartirla entre los que vigilan la fuente (acá no hay fuente).
        profileId,
        fingerprint: fp,
        externalId: url || null,
        url,
        title: this.resolveTitle(input.title, cleaned),
        company: (input.company ?? '').trim() || null,
        descriptionRaw: cleaned,
        // `autoCoverLetter` lo lee la etapa de HV para generar la carta de una.
        raw: { manual: true, autoCoverLetter: true },
      },
    });

    await this.normalizeQueue.add(
      'default',
      { vacancyId: vacancy.id },
      {
        jobId: `normalize-${vacancy.id}`,
        attempts: 4,
        backoff: { type: 'exponential' as const, delay: 3000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );

    this.logger.log(
      {
        msg: 'oferta pegada encolada para normalizar',
        vacancyId: vacancy.id,
        profileId,
        chars: cleaned.length,
      },
      ManualIntakeService.name,
    );

    return { vacancyId: vacancy.id, reused: false, profileId };
  }

  /** Perfil destino: el elegido (validado) o el primario. */
  private async resolveProfileId(requested?: string | null): Promise<string> {
    if (requested) {
      const profile = await this.prisma.profile.findUnique({
        where: { id: requested },
        select: { id: true },
      });
      if (!profile) throw new BadRequestException(`Perfil ${requested} no existe`);
      return profile.id;
    }
    const primary = await this.prisma.profile.findFirst({
      where: { isPrimary: true },
      select: { id: true },
    });
    if (primary) return primary.id;
    const any = await this.prisma.profile.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!any) throw new BadRequestException('No hay perfiles: creá uno antes de pegar una oferta');
    return any.id;
  }

  /** La fuente sintética (una sola fila, reutilizada por todas las pegadas). */
  private async manualSourceId(): Promise<string> {
    const existing = await this.prisma.source.findFirst({
      where: { kind: 'MANUAL' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.source.create({
      data: {
        name: 'Pegada manual',
        kind: 'MANUAL',
        baseUrl: '',
        listUrl: '',
        selectors: {},
        // Deshabilitada a propósito: el scheduler nunca la manda al scraper.
        enabled: false,
        intervalMinutes: 0,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Asegura que este perfil evalúe una vacante ya guardada (mismo pegado o misma
   * URL). Si todavía está en RAW, el job de normalización en vuelo ya hará el
   * fan-out; si ya se normalizó, se encola el match directo (no hace falta
   * volver a llamar a la IA del normalizador).
   */
  private async ensureMatch(vacancyId: string, profileId: string): Promise<void> {
    await this.prisma.vacancyProfile.upsert({
      where: { vacancyId_profileId: { vacancyId, profileId } },
      update: {},
      create: { vacancyId, profileId },
    });

    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      select: { status: true },
    });
    if (!vacancy || vacancy.status === VacancyStatus.RAW) return;

    await this.matchQueue.add(
      'default',
      { vacancyId, profileId },
      {
        jobId: `match-${vacancyId}-${profileId}`,
        attempts: 4,
        backoff: { type: 'exponential' as const, delay: 3000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      },
    );
  }

  /** Título explícito, o la primera línea útil del texto, o un genérico. */
  private resolveTitle(explicit: string | null | undefined, cleaned: string): string {
    const given = (explicit ?? '').trim();
    if (given) return given;
    const line = cleaned
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 6 && l.length <= 120);
    return line ?? 'Oferta pegada';
  }
}
