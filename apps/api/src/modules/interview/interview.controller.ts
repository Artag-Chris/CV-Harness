import { Body, Controller, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { InterviewService } from './interview.service';

const EditInterviewPrepSchema = z.object({ content: z.record(z.unknown()) });

/** Genera la preparación a pedido (vacante ya aplicada). */
@Controller('vacancies')
export class InterviewVacancyController {
  constructor(private readonly interviews: InterviewService) {}

  @Post(':id/interview-prep')
  generate(@Param('id') id: string, @Query('profileId') profileId?: string) {
    return this.interviews.enqueue(id, profileId);
  }
}

/** Guarda el plan editado a mano desde el dashboard. */
@Controller('interview-prep')
export class InterviewPrepController {
  constructor(private readonly interviews: InterviewService) {}

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const input = EditInterviewPrepSchema.parse(body);
    return this.interviews.saveEdited(id, input.content);
  }
}
