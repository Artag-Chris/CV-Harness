import { Body, Controller, NotFoundException, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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

    const { markdown: _ignored, ...content } = input.content;
    const parsed = ResumeContentSchema.parse(content);
    const markdown = renderResumeMarkdown(
      parsed,
      resume.profile?.name ?? 'CV',
    );
    // La carta de presentación vive en el mismo JSON: se preserva tal cual, si
    // no este PATCH (que solo re-renderiza el markdown) la borraría.
    const previous = (resume.content ?? {}) as Record<string, unknown>;
    const coverLetterFields = {
      ...(typeof previous.coverLetter === 'string'
        ? {
            coverLetter: previous.coverLetter,
            coverLetterSource: previous.coverLetterSource,
            coverLetterUpdatedAt: previous.coverLetterUpdatedAt,
          }
        : {}),
    };

    return this.prisma.resumeDraft.update({
      where: { id },
      data: {
        content: { ...parsed, markdown, ...coverLetterFields } as Prisma.InputJsonValue,
        status: 'FINAL',
        version: { increment: 1 },
      },
    });
  }
}
