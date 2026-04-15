import { Controller, Post, Get, Body, UseGuards, Request, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
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
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
  logout(@Request() req) {
    return this.authService.logout(req.user.id);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getSessions(@Request() req, @Query('days') days?: string) {
    return this.authService.getSessions(req.user.id, days ? parseInt(days) : 7);
  }
}
