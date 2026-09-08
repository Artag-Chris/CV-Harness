import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ResumeKind, ResumeStatus } from '@prisma/client';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../common/prisma.service';
import { EMBEDDING_PROVIDER } from '../../config/tokens';
import { EmbeddingProvider } from '../embeddings/embedding-provider.port';
import { chunkResumeText } from './resume-chunker';

interface SemanticHit {
  id: string;
  content: string;
  similarity: number; // 0..1
}

/**
 * Hojas de vida cargadas desde el dashboard: persistencia del texto, troceo,
 * embedding en pgvector y búsqueda semántica para el match.
 */
@Injectable()
export class ResumesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings: EmbeddingProvider,
    private readonly logger: JsonLogger,
  ) {}

  /** Instancia real del proveedor (el constructor recibe la instancia DI). */
  get providerName(): string {
    return this.embeddings.name;
  }

  async list(profileId: string) {
    return this.prisma.resume.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async get(id: string) {
    const resume = await this.prisma.resume.findUnique({ where: { id } });
    if (!resume) throw new NotFoundException(`Resume ${id} no existe`);
    return resume;
  }

  async createFromText(input: { profileId: string; name: string; content: string }) {
    return this.createResume({
      profileId: input.profileId,
      name: input.name.trim() || 'Hoja de vida (texto)',
      kind: ResumeKind.MARKDOWN,
      rawText: input.content,
    });
  }

  async createFromPdf(input: { profileId: string; name: string; buffer: Buffer }) {
    // Import dinámico: pdf-parse es pesado y solo se usa al subir PDFs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(input.buffer as Buffer);
    const rawText = String(parsed.text ?? '');
    return this.createResume({
      profileId: input.profileId,
      name: input.name.trim() || 'Hoja de vida (PDF)',
      kind: ResumeKind.PDF,
      rawText,
    });
  }

  async activate(id: string, profileId: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id, profileId } });
    if (!resume) throw new NotFoundException(`Resume ${id} no existe en el perfil`);
    // Solo una activa por perfil.
    await this.prisma.$transaction([
      this.prisma.resume.updateMany({
        where: { profileId, active: true },
        data: { active: false },
      }),
      this.prisma.resume.update({
        where: { id },
        data: { active: true },
      }),
    ]);
    return this.get(id);
  }

  async remove(id: string, profileId: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id, profileId } });
    if (!resume) throw new NotFoundException(`Resume ${id} no existe`);
    await this.prisma.resume.delete({ where: { id } });
    return { ok: true };
  }

  /** Indexa (o re-indexa) los chunks de una hoja de vida con sus embeddings. */
  async index(resumeId: string): Promise<void> {
    const resume = await this.get(resumeId);
    await this.prisma.resume.update({
      where: { id: resumeId },
      data: { status: ResumeStatus.EMBEDDING, error: null },
    });

    try {
      // 1) Chunks de texto (regenera siempre — re-indexar es idempotente).
      await this.prisma.resumeChunk.deleteMany({ where: { resumeId } });
      const chunks = chunkResumeText(resume.rawText);
      if (chunks.length === 0) {
        throw new Error('No se pudo extraer texto para indexar');
      }
      await this.prisma.resumeChunk.createMany({
        data: chunks.map((content, index) => ({ resumeId, index, content })),
      });

      // 2) Embeddings por lote.
      const vectors = await this.embeddings.embed(chunks);
      if (vectors.length !== chunks.length) {
        throw new Error('Cantidad de vectores no coincide con los chunks');
      }

      // 3) Guardar en pgvector (columna fuera del schema de Prisma).
      for (let i = 0; i < chunks.length; i++) {
        const literal = `[${vectors[i].join(',')}]`;
        await this.prisma.$executeRaw`
          UPDATE "ResumeChunk"
          SET embedding = (${literal})::vector
          WHERE "resumeId" = ${resumeId} AND "index" = ${i}
        `;
      }

      await this.prisma.resume.update({
        where: { id: resumeId },
        data: { status: ResumeStatus.READY, chunkCount: chunks.length },
      });
      this.logger.log(
        { msg: 'HV indexada en pgvector', resumeId, chunks: chunks.length, provider: this.embeddings.name },
        ResumesService.name,
      );
    } catch (err) {
      await this.prisma.resume.update({
        where: { id: resumeId },
        data: { status: ResumeStatus.FAILED, error: String(err).slice(0, 500) },
      });
      this.logger.error(
        { msg: 'falló el indexado de la HV', resumeId, err: String(err) },
        ResumesService.name,
      );
      throw err;
    }
  }

  /** Embeddings del texto (usa el mismo proveedor). */
  async embedText(text: string): Promise<number[]> {
    const [vec] = await this.embeddings.embed([text]);
    return vec;
  }

  /**
   * Búsqueda semántica sobre la HV activa del perfil. Devuelve los top-k
   * chunks con su similitud y el mejor score (0-100), o null si el perfil no
   * tiene una HV activa e indexada.
   */
  async searchActiveResume(
    profileId: string | null,
    queryText: string,
    limit = 5,
  ): Promise<{ hits: SemanticHit[]; bestScore: number | null }> {
    const active = await this.prisma.resume.findFirst({
      where: { profileId: profileId ?? undefined, active: true, status: ResumeStatus.READY },
      select: { id: true },
    });
    if (!active) return { hits: [], bestScore: null };

    const query = (await this.embeddings.embed([queryText]))[0];
    const literal = `[${query.join(',')}]`;
    const rows = await this.prisma.$queryRaw<{ id: string; content: string; sim: number }[]>`
      SELECT id, content, 1 - (embedding <=> (${literal})::vector) AS sim
      FROM "ResumeChunk"
      WHERE "resumeId" = ${active.id}
      ORDER BY sim DESC
      LIMIT ${limit}
    `;
    const hits = rows
      .filter((r) => r.sim !== null && r.sim > 0)
      .map((r) => ({ id: r.id, content: r.content, similarity: clamp01(r.sim) }));
    const bestScore = hits.length > 0 ? Math.round(clamp01(hits[0].similarity) * 100) : null;
    return { hits, bestScore };
  }

  private async createResume(input: {
    profileId: string;
    name: string;
    kind: ResumeKind;
    rawText: string;
  }) {
    const resume = await this.prisma.resume.create({
      data: {
        profileId: input.profileId,
        name: input.name,
        kind: input.kind,
        rawText: input.rawText,
        status: ResumeStatus.PENDING,
      },
    });
    // Nota: el job de indexado lo encola el controlador para no acoplar.
    return resume;
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export type { SemanticHit };
