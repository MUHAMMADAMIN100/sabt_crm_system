import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';

@ApiTags('Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private service: CalendarService) {}

  @Get('events')
  @RequirePerm('calendar.view')
  getEvents(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('employeeId') employeeId?: string,
    @Query('projectId') projectId?: string,
    @Query('scope') scope?: 'personal' | 'business' | 'general',
    @Request() req?,
  ) {
    return this.service.getEvents(from, to, employeeId, projectId, scope, req?.user?.id, req?.user?.role);
  }
}
