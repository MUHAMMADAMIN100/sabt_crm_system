import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { WorkShiftsService } from './work-shifts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Work shifts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('work-shifts')
export class WorkShiftsController {
  constructor(private service: WorkShiftsService) {}

  /** Моя смена: идёт ли сейчас и сколько наработано за сегодня. */
  @Get('my')
  my(@Request() req) {
    return this.service.my(req.user.id);
  }

  @Post('start')
  start(@Request() req) {
    return this.service.start(req.user.id);
  }

  @Post('stop')
  stop(@Request() req) {
    return this.service.stop(req.user.id);
  }

  /** Перерыв: отрезок закрывается, день остаётся открытым. Причина решает,
   *  идёт ли время в часы: обед — до лимита, выезд по работе — целиком,
   *  личное — нет. */
  @Post('pause')
  pause(@Request() req, @Body() body?: { kind?: 'lunch' | 'work' | 'personal' }) {
    return this.service.pause(req.user.id, body?.kind);
  }

  // ─── «Забыл нажать»: правки времени ───────────────────────────────
  @Post('edit-request')
  requestEdit(@Request() req, @Body() body: { date?: string; field: 'start' | 'end'; time: string; note?: string }) {
    return this.service.requestEdit(req.user.id, body);
  }

  @Get('my-edits')
  myEdits(@Request() req) {
    return this.service.myEdits(req.user.id);
  }

  /** Очередь правок и решение по ним — только руководству. */
  @Get('edits')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  edits() {
    return this.service.pendingEdits();
  }

  @Patch('edits/:id')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  decideEdit(@Request() req, @Param('id') id: string, @Body() body: { approve: boolean }) {
    return this.service.decideEdit(id, !!body?.approve, req.user.id);
  }

  /** Мой табель за месяц — личный профиль, только свои часы. */
  @Get('my-month')
  myMonth(@Request() req, @Query('ym') ym?: string) {
    return this.service.myMonth(req.user.id, ym);
  }

  /** Табель за месяц: часы по дням, итоги и отрезки смен. */
  @Get('month')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  month(@Query('ym') ym?: string) {
    return this.service.month(ym);
  }

  /** Сводка по команде — только руководству компании. */
  @Get('team')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  team(@Query('date') date?: string) {
    return this.service.team(date);
  }
}
