import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileStatsService } from './profile-stats.service';

/** Личный профиль: аналитика — строго себе (id из токена), цели месяца —
 *  руководителю направления и основателю (проверка в сервисе). */
@ApiTags('Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ProfileStatsController {
  constructor(private service: ProfileStatsService) {}

  /** Эффективность, серии, уровень, достижения, цели и бонус — себе. */
  @Get('me/profile-stats')
  mine(@Request() req: any) {
    return this.service.forMe(req.user);
  }

  /** Цели сотрудника за месяц: { ym, canEdit, goals, metrics }. */
  @Get('goals/user/:userId')
  goals(@Param('userId') userId: string, @Query('ym') ym: string, @Request() req: any) {
    return this.service.goalsOf(userId, req.user, ym);
  }

  /** Поставить цель: { userId, ym?, title, metric?, target? }. */
  @Post('goals')
  create(@Body() body: any, @Request() req: any) {
    return this.service.createGoal(req.user, body);
  }

  /** Изменить цель; сотрудник может только отметить «выполнено» { done }. */
  @Patch('goals/:id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.updateGoal(req.user, id, body);
  }

  @Delete('goals/:id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.deleteGoal(req.user, id);
  }
}
