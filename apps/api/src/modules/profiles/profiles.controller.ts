import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.profile.findMany({
      select: {
        id: true,
        name: true,
        headline: true,
        email: true,
        isPrimary: true,
        _count: { select: { skills: true, projects: true, experiences: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get('primary')
  primary() {
    return this.prisma.profile.findFirst({
      where: { isPrimary: true },
      include: {
        links: true,
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
      },
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        links: true,
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        projects: true,
        skills: { include: { skill: true }, orderBy: { rating: 'desc' } },
      },
    });
  }
}
