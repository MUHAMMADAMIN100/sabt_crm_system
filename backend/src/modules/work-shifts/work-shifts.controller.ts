import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, Request } from '@nestjs/common';
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

  // ─── Личный график смены ───────────────────────────────────────────
  @Get('schedules')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  schedules() {
    return this.service.schedules();
  }

  @Patch('schedules/:userId')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  setSchedule(@Request() req, @Param('userId') userId: string, @Body() body: any) {
    return this.service.setSchedule(userId, body || {}, req.user.id);
  }

  @Patch('settings')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER)
  setSettings(@Body() body: any) {
    return this.service.setSettings(body || {});
  }

  // ─── «Приду позже» ─────────────────────────────────────────────────
  @Post('notices')
  createNotice(@Request() req, @Body() body: { date: string; time: string; reason?: string }) {
    return this.service.createNotice(req.user.id, body);
  }

  @Get('my-notices')
  myNotices(@Request() req) {
    return this.service.myNotices(req.user.id);
  }

  @Get('notices')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  notices() {
    return this.service.notices();
  }

  @Patch('notices/:id')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  decideNotice(@Request() req, @Param('id') id: string, @Body() body: { approve: boolean }) {
    return this.service.decideNotice(id, !!body?.approve, req.user.id);
  }

  // ─── Отгул / отпуск / больничный — ставит руководство ──────────────
  @Post('absence')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  setAbsence(@Request() req, @Body() body: { employeeId: string; date: string; kind: 'dayoff' | 'vacation' | 'sick' | 'holiday'; note?: string }) {
    return this.service.setAbsence(body, req.user.id);
  }

  @Delete('absence')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  removeAbsence(@Query('employeeId') employeeId: string, @Query('date') date: string) {
    return this.service.removeAbsence(employeeId, date);
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
