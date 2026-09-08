import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.list(
      limit ? Number(limit) : 50,
      unreadOnly === 'true',
    );
  }

  @Get('unread-count')
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post(':id/read')
  async read(@Param('id') id: string) {
    const row = await this.notifications.markRead(id);
    return { ok: true, notification: row };
  }
}
