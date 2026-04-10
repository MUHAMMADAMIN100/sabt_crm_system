import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
// PM_ROLES convenience list for decorator
const { ADMIN, FOUNDER, PROJECT_MANAGER } = UserRole;
import { TaskStatus, TaskPriority } from './task.entity';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private service: TasksService) {}

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('search') search?: string,
    @Query('deadlineBefore') deadlineBefore?: string,
  ) {
    return this.service.findAll({ projectId, assigneeId, status, priority, search, deadlineBefore });
  }

  @Get('export/csv')
  async exportCsv(
    @Query('projectId') projectId: string,
    @Query('assigneeId') assigneeId: string,
    @Query('status') status: TaskStatus,
    @Res() res: Response,
  ) {
    const tasks = await this.service.findAll({ projectId, assigneeId, status });
    const header = 'ID,Title,Status,Priority,Project,Assignee,Deadline,LoggedHours\n';
    const rows = tasks.map(t =>
      [
        t.id,
        `"${(t.title || '').replace(/"/g, '""')}"`,
        t.status,
        t.priority,
        `"${(t.project?.name || '').replace(/"/g, '""')}"`,
        `"${(t.assignee?.name || '').replace(/"/g, '""')}"`,
        t.deadline ? new Date(t.deadline).toISOString().split('T')[0] : '',
        t.loggedHours ?? 0,
      ].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send('\uFEFF' + header + rows);
  }

  @Get('my')
  getMyTasks(@Request() req) {
    return this.service.getMyTasks(req.user.id);
  }

  @Get('overdue')
  @Roles(ADMIN, FOUNDER, PROJECT_MANAGER)
  getOverdue() { return this.service.getOverdueTasks(); }

  @Get('stats')
  getStats(@Query('projectId') projectId?: string) {
    return this.service.getStats(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateTaskDto, @Request() req) {
    return this.service.create(dto, req.user.id, req.user.role);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Post(':id/approve')
  @Roles(ADMIN, FOUNDER, PROJECT_MANAGER)
  approve(@Param('id') id: string, @Request() req) {
    return this.service.approveTask(id, req.user);
  }

  @Post(':id/return')
  @Roles(ADMIN, FOUNDER, PROJECT_MANAGER)
  returnTask(@Param('id') id: string, @Body('reason') reason: string, @Request() req) {
    return this.service.returnTask(id, req.user, reason || 'Требует доработки');
  }

  @Post('bulk')
  @Roles(ADMIN, FOUNDER, PROJECT_MANAGER)
  bulk(
    @Body('ids') ids: string[],
    @Body('action') action: 'status' | 'delete' | 'assign',
    @Body('value') value: string,
    @Request() req,
  ) {
    return this.service.bulkAction(ids, action, value, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.removeWithAuth(id, req.user);
  }
}
