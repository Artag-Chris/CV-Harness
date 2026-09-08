import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { NotificationJob } from '../pipeline/pipeline.types';

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea una notificación en la bandeja (adapter inbox del puerto de notificación). */
  async create(job: NotificationJob): Promise<NotificationRow> {
    // Idempotencia: reintentos (at-least-once de las colas) no deben duplicar
    // notificaciones del mismo evento en la última hora.
    const since = new Date(Date.now() - 60 * 60_000);
    const recent = await this.prisma.notification.findFirst({
      where: { type: job.type, title: job.title, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return recent;

    const row = await this.prisma.notification.create({
      data: {
        type: job.type,
        title: job.title,
        body: job.body,
        payload: job.payload as Prisma.InputJsonValue,
      },
    });
    return row;
  }

  async list(limit = 50, unreadOnly = false): Promise<NotificationRow[]> {
    return this.prisma.notification.findMany({
      where: unreadOnly ? { readAt: null } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markRead(id: string): Promise<NotificationRow> {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async unreadCount(): Promise<number> {
    return this.prisma.notification.count({ where: { readAt: null } });
  }
}
