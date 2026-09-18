import { Controller, Get, Post, Query, UseGuards, Request } from '@nestjs/common';
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

  /** Сводка по команде — только руководству компании. */
  @Get('team')
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN)
  team(@Query('date') date?: string) {
    return this.service.team(date);
  }
}
