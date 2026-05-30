import { Controller, Post, Get, Body, UseGuards, Request, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Имя httpOnly-куки, в которой хранится JWT. Cross-site (Vercel ↔ Railway)
 *  поэтому нужны SameSite=None + Secure. JavaScript прочитать не может. */
const AUTH_COOKIE = 'auth_token';
const COOKIE_OPTS = {
  httpOnly: true as const,
  secure: true as const,
  sameSite: 'none' as const,
  path: '/',
  // 7 дней — синхронно с JWT TTL
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register new user' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    if (result?.token) res.cookie(AUTH_COOKIE, result.token, COOKIE_OPTS);
    return result;
  }

  @Get('founder-exists')
  @SkipThrottle()
  @ApiOperation({ summary: 'Check if a founder is already registered (public)' })
  async founderExists() {
    const exists = await this.authService.founderExists();
    return { exists };
  }

  @Get('co-founder-exists')
  @SkipThrottle()
  @ApiOperation({ summary: 'Check if a co-founder is already registered (public)' })
  async coFounderExists() {
    const exists = await this.authService.coFounderExists();
    return { exists };
  }

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Login' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if (result?.token) res.cookie(AUTH_COOKIE, result.token, COOKIE_OPTS);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getMe(@Request() req) {
    return this.authService.getMe(req.user.id);
  }

  @Post('forgot-password')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  changePassword(@Request() req, @Body() body: { oldPassword: string; newPassword: string }) {
    return this.authService.changePassword(req.user.id, body.oldPassword, body.newPassword);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@Request() req, @Res({ passthrough: true }) res: Response) {
    // Чистим httpOnly cookie — после logout даже украденный токен бесполезен
    // на нашем домене (cookie уже нет в браузере). На бэке закрываем сессию.
    res.clearCookie(AUTH_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
    return this.authService.logout(req.user.id);
  }

  @Post('heartbeat')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async heartbeat(@Request() req) {
    await this.authService.heartbeat(req.user.id);
    return { ok: true };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getSessions(@Request() req, @Query('days') days?: string) {
    return this.authService.getSessions(req.user.id, days ? parseInt(days) : 7);
  }
}
