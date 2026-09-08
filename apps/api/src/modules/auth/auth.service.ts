import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { PrismaService } from '../../common/prisma.service';
import { AuthPayload } from './auth.guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; email: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalized },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: AuthPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    });
    return { accessToken, email: user.email };
  }
}
