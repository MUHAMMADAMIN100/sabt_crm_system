import { Controller, Post, Get, Body, UseGuards, Request, Patch, Query, Res, Req } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Имя httpOnly-куки, в которой хранится JWT. Cross-site (Vercel ↔ Railway)
 *  поэтому нужны SameSite=None + Secure. JavaScript прочитать не может. */
const AUTH_COOKIE = 'auth_token';
const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: true as const,
  sameSite: 'none' as const,
  path: '/',
  // 15 минут — синхронно с JWT_ACCESS_TTL
  maxAge: 15 * 60 * 1000,
};
const REFRESH_COOKIE_OPTS = {
  ...ACCESS_COOKIE_OPTS,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
};
const COOKIE_OPTS = ACCESS_COOKIE_OPTS; // alias для clearCookie

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register new user' })
  async register(@Body() dto: RegisterDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto, req);
    if (result?.token) res.cookie(AUTH_COOKIE, result.token, ACCESS_COOKIE_OPTS);
    if ((result as any)?.refreshToken) {
      res.cookie(REFRESH_COOKIE, (result as any).refreshToken, REFRESH_COOKIE_OPTS);
    }
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
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, req);
    if (result?.token) res.cookie(AUTH_COOKIE, result.token, ACCESS_COOKIE_OPTS);
    if ((result as any)?.refreshToken) {
      res.cookie(REFRESH_COOKIE, (result as any).refreshToken, REFRESH_COOKIE_OPTS);
    }
    return result;
  }

  @Post('refresh')
  @SkipThrottle()
  @ApiOperation({ summary: 'Rotate access token via refresh cookie or body' })
  async refresh(
    @Req() req: any,
    @Body() body: { refreshToken?: string } | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Источники refresh-токена (по приоритету):
    //  1) httpOnly cookie (стандартный путь);
    //  2) body.refreshToken — для браузеров, блокирующих third-party cookies
    //     (Chrome с anti-tracking, incognito и т.д.).
    const raw = req.cookies?.[REFRESH_COOKIE] || body?.refreshToken;
    const { accessToken, refreshToken, user } = await this.authService.refresh(raw, req);
    res.cookie(AUTH_COOKIE, accessToken, ACCESS_COOKIE_OPTS);
    res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTS);
    // Тело тоже отдаём — фронт сохраняет в sessionStorage если cookie
    // не сработала. Это допустимо для access-токена (15 мин), и работает
    // как fallback для refresh-токена тоже.
    return { accessToken, refreshToken, user };
  }

  // ─── 2FA ────────────────────────────────────────────────────────────

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  setup2FA(@Request() req) {
    return this.authService.setup2FA(req.user.id);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  enable2FA(@Request() req, @Body() body: TwoFactorCodeDto) {
    return this.authService.enable2FA(req.user.id, body.code, req);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  disable2FA(@Request() req, @Body() body: TwoFactorCodeDto) {
    return this.authService.disable2FA(req.user.id, body.code, req);
  }

  @Get('security-log')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  securityLog(
    @Request() req,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    // Только админ / основатель / со-основатель видят журнал безопасности.
    const role = req.user?.role;
    if (!['admin', 'founder', 'co_founder'].includes(role)) {
      return { events: [] };
    }
    return this.authService.getSecurityLog({ type: type as any, limit: limit ? Number(limit) : undefined });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getMe(@Request() req) {
    return this.authService.getMe(req.user.id);
  }

  @Post('forgot-password')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  changePassword(@Request() req, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, body.oldPassword, body.newPassword);
  }

  /** Персональный акцентный цвет интерфейса. Меняет только СВОЮ
   *  настройку; список допустимых значений зашит на бэке. */
  @Patch('theme')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  setTheme(@Request() req, @Body() body: { themeColor?: string }) {
    return this.authService.setThemeColor(req.user.id, body?.themeColor ?? null);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@Request() req, @Res({ passthrough: true }) res: Response) {
    // Чистим обе httpOnly cookies. На бэке закрываем сессию и отзываем
    // все refresh-токены этого пользователя.
    res.clearCookie(AUTH_COOKIE, { ...ACCESS_COOKIE_OPTS, maxAge: 0 });
    res.clearCookie(REFRESH_COOKIE, { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
    return this.authService.logout(req.user.id, req);
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
