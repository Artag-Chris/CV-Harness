import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    if (!body.email || !body.password) {
      return { error: 'email y password son requeridos' };
    }
    return this.auth.login(body.email, body.password);
  }
}
