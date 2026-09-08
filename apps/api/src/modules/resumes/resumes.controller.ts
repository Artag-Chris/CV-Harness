import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ActivateResumeDto, ResumeTextDto } from '../../common/api-dto';
import { queueName, QUEUES } from '../../config/queue.config';
import { ResumesService } from './resumes.service';

/**
 * Hojas de vida del dashboard. El indexado en pgvector corre en la cola
 * resume-index (event-driven); el POST responde apenas guarda el texto.
 */
@Controller('resumes')
export class ResumesController {
  constructor(
    private readonly resumes: ResumesService,
    @InjectQueue(queueName(QUEUES.RESUME_INDEX))
    private readonly indexQueue: Queue,
  ) {}

  @Get()
  list(@Query('profileId') profileId?: string) {
    if (!profileId) throw new BadRequestException('profileId es requerido');
    return this.resumes.list(profileId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { profileId?: string; name?: string },
  ) {
    if (!file || !body.profileId) {
      throw new BadRequestException('file y profileId son requeridos');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan PDFs');
    }
    const resume = await this.resumes.createFromPdf({
      profileId: body.profileId,
      name: body.name ?? file.originalname,
      buffer: file.buffer,
    });
    await this.enqueueIndex(resume.id);
    return resume;
  }

  @Post('text')
  async fromText(@Body() body: ResumeTextDto) {
    if (!body.profileId || !body.content?.trim()) {
      throw new BadRequestException('profileId y content son requeridos');
    }
    const resume = await this.resumes.createFromText({
      profileId: body.profileId,
      name: body.name ?? '',
      content: body.content,
    });
    await this.enqueueIndex(resume.id);
    return resume;
  }

  @Post(':id/activate')
  async activate(@Param('id') id: string, @Body() body: ActivateResumeDto) {
    const resume = await this.resumes.activate(id, body.profileId);
    // El backfill de re-match se encola al activar (lo resuelve el pipeline N:M).
    return resume;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Query('profileId') profileId?: string) {
    if (!profileId) throw new BadRequestException('profileId es requerido');
    return this.resumes.remove(id, profileId);
  }

  private async enqueueIndex(resumeId: string): Promise<void> {
    await this.indexQueue.add(
      'default',
      { resumeId },
      {
        jobId: `resume-index-${resumeId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: { age: 7 * 86400 },
      },
    );
  }
}
