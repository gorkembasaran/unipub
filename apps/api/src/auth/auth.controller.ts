import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: { fullName?: string; email?: string; password?: string }) {
    return this.authService.register(
      body.fullName ?? '',
      body.email ?? '',
      body.password ?? '',
    );
  }

  @Post('login')
  login(@Body() body: { email?: string; password?: string }) {
    return this.authService.login(body.email ?? '', body.password ?? '');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    return this.authService.me(token);
  }
}
