import { Body, Controller, NotFoundException, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { normalizeApplyLanguage } from '../../common/apply-language';
import { PrismaService } from '../../common/prisma.service';
import { ResumeContentSchema } from '../pipeline/pipeline.types';
import { renderResumeMarkdown } from '../resume/resume-markdown';

const EditResumeSchema = z.object({ content: z.record(z.unknown()) });

/**
 * Edición del borrador de HV desde el dashboard: re-renderiza el markdown
 * a partir del contenido estructurado editado.
 */
@Controller('resumes')
export class ResumeController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const input = EditResumeSchema.parse(body);
    const resume = await this.prisma.resumeDraft.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!resume) throw new NotFoundException(`Resume ${id} no existe`);

    const { markdown: _ignored, ...rest } = input.content;
    const parsed = ResumeContentSchema.parse(rest);
    // El idioma (auto|es|en) no es contenido redactado: zod lo descartaría, así
    // que se rescata aparte para que el selector por HV pueda persistirlo.
    const language = normalizeApplyLanguage(rest.language);
    // El Modo ATS tampoco es texto redactado: zod lo descarta y, sin rescatarlo,
    // activarlo se perdía en el primer guardado (el PDF salía a dos columnas y el
    // score volvía atrás al recargar).
    const atsMode = rest.atsMode === true;
    const markdown = renderResumeMarkdown(
      parsed,
      resume.profile?.name ?? 'CV',
    );
    // La carta de presentación vive en el mismo JSON del borrador. Si viene en
    // el body se guarda como editada a mano; si no, se conserva la que había
    // (este PATCH solo re-renderiza el markdown y antes la borraba).
    const editedLetter =
      typeof rest.coverLetter === 'string' ? rest.coverLetter.trim() : null;
    const previous = (resume.content ?? {}) as Record<string, unknown>;
    const coverLetterFields = editedLetter
      ? {
          coverLetter: editedLetter,
          coverLetterSource: 'editada',
          coverLetterUpdatedAt: new Date().toISOString(),
        }
      : typeof previous.coverLetter === 'string'
        ? {
            coverLetter: previous.coverLetter,
            coverLetterSource: previous.coverLetterSource,
            coverLetterUpdatedAt: previous.coverLetterUpdatedAt,
          }
        : {};

    return this.prisma.resumeDraft.update({
      where: { id },
      data: {
        content: {
          ...parsed,
          markdown,
          ...(language ? { language } : {}),
          ...(atsMode ? { atsMode: true } : {}),
          ...coverLetterFields,
        } as Prisma.InputJsonValue,
        status: 'FINAL',
        version: { increment: 1 },
      },
    });
  }
}
