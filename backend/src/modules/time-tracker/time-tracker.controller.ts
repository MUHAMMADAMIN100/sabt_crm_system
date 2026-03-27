import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TimeTrackerService } from './time-tracker.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('TimeTracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
  getByEmployee(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.findByEmployee(id, from, to);
  }

  @Get('task/:taskId')
  getByTask(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId);
  }

  @Get('task/:taskId/total')
  getTotal(@Param('taskId') taskId: string) {
    return this.service.getTotalByTask(taskId);
  }

  @Get('summary/:employeeId')
  getSummary(
    @Param('employeeId') employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getSummaryByEmployee(employeeId, from, to);
  }

  @Post('start')
  start(@Body() body: { taskId: string }, @Request() req) {
    return this.service.startTimer(body.taskId, req.user.id);
  }

  @Post('stop')
  stop(@Request() req) {
    return this.service.stopTimer(req.user.id);
  }

  @Post('log')
  log(
    @Body() body: { taskId: string; timeSpent: number; date: string; description?: string },
    @Request() req,
  ) {
    return this.service.logTime(body.taskId, req.user.id, body.timeSpent, body.date, body.description);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
