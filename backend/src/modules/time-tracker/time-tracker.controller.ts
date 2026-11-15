import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TimeTrackerService } from './time-tracker.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';

// Руководители: чужие тайм-логи и сводки. dev_director и pm_dev — тоже,
// основной или второй ролью (15.11.2026).
const PM_ROLES = new Set(['admin', 'founder', 'smm_director', 'dev_director', 'pm_dev']);
const isPm = (u: any) => PM_ROLES.has(u?.role) || PM_ROLES.has(u?.secondaryRole);

class StartTimerDto {
  @ApiProperty() @IsUUID()
  taskId: string;
}

class LogTimeDto {
  @ApiProperty() @IsUUID()
  taskId: string;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  timeSpent: number;

  @ApiProperty() @IsISO8601()
  date: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}

@ApiTags('TimeTracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('time-tracker')
export class TimeTrackerController {
  constructor(private service: TimeTrackerService) {}

  @Get('my')
  getMyLogs(@Request() req, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.findByEmployee(req.user.id, from, to);
  }

  @Get('running')
  getRunning(@Request() req) {
    return this.service.getRunningTimer(req.user.id);
  }

  @Get('employee/:id')
  getByEmployee(
    @Param('id') id: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // IDOR-защита: чужие тайм-логи могут смотреть только PM-роли.
    if (id !== req.user.id && !isPm(req.user)) {
      throw new ForbiddenException('Нет доступа к тайм-логам другого сотрудника');
    }
    return this.service.findByEmployee(id, from, to);
  }

  @Get('task/:taskId')
  getByTask(@Param('taskId') taskId: string, @Request() req) {
    // Проверка доступа к задаче (15.11.2026).
    return this.service.findByTask(taskId, req.user);
  }

  @Get('task/:taskId/total')
  getTotal(@Param('taskId') taskId: string, @Request() req) {
    return this.service.getTotalByTask(taskId, req.user);
  }

  @Get('summary/:employeeId')
  getSummary(
    @Param('employeeId') employeeId: string,
    @Request() req,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (employeeId !== req.user.id && !isPm(req.user)) {
      throw new ForbiddenException('Нет доступа к сводке другого сотрудника');
    }
    return this.service.getSummaryByEmployee(employeeId, from, to);
  }

  @Post('start')
  @RequirePerm('time-tracker.use')
  start(@Body() body: StartTimerDto, @Request() req) {
    return this.service.startTimer(body.taskId, req.user.id, req.user.role, req.user.secondaryRole);
  }

  @Post('stop')
  @RequirePerm('time-tracker.use')
  stop(@Request() req) {
    return this.service.stopTimer(req.user.id);
  }

  @Post('log')
  @RequirePerm('time-tracker.use')
  log(@Body() body: LogTimeDto, @Request() req) {
    return this.service.logTime(
      body.taskId, req.user.id, req.user.role, body.timeSpent, body.date, body.description, req.user.secondaryRole,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role, req.user.secondaryRole);
  }
}
