import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private service: CalendarService) {}

  @Get('events')
  getEvents(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('employeeId') employeeId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.getEvents(from, to, employeeId, projectId);
  }
}
