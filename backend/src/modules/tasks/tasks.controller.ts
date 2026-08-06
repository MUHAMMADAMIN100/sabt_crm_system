import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { UserRole } from '../users/user.entity';
// PM_ROLES convenience list for decorator
const { ADMIN, FOUNDER, CO_FOUNDER, VIDEO_DIRECTOR, SMM_DIRECTOR } = UserRole;
import { TaskStatus, TaskPriority } from './task.entity';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private service: TasksService) {}

  @Get()
  @RequirePerm('tasks.view')
  findAll(
    @Query('projectId') projectId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('search') search?: string,
    @Query('deadlineBefore') deadlineBefore?: string,
    @Query('scope') scope?: 'personal' | 'business' | 'general',
    @Request() req?,
  ) {
    return this.service.findAll({
      projectId, assigneeId, status, priority, search, deadlineBefore, scope,
      viewerId: req?.user?.id,
      viewerRole: req?.user?.role,
      viewerSecondaryRole: req?.user?.secondaryRole,
    });
  }

  @Get('export/csv')
  @RequirePerm('tasks.export')
  async exportCsv(
    @Query('projectId') projectId: string,
    @Query('assigneeId') assigneeId: string,
    @Query('status') status: TaskStatus,
    @Res() res: Response,
    @Request() req?,
  ) {
    const tasks = await this.service.findAll({
      projectId, assigneeId, status,
      viewerId: req?.user?.id,
      viewerRole: req?.user?.role,
      viewerSecondaryRole: req?.user?.secondaryRole,
    });
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

  /** Раздел «Задачи от руководителя»: поручения, выданные сотруднику
   *  основателем/сооснователем/админом/руководителями направлений. */
  @Get('from-management')
  getFromManagement(@Request() req) {
    return this.service.getTasksFromManagement(req.user.id);
  }

  /** Вкладка «Я выдал» — задачи, поставленные текущим пользователем: видно,
   *  на каком статусе задача у каждого сотрудника. */
  @Get('assigned-by-me')
  getAssignedByMe(@Request() req) {
    return this.service.getTasksAssignedByMe(req.user.id);
  }

  @Get('overdue')
  @RequirePerm('tasks.overdue.view')
  getOverdue(@Request() req) { return this.service.getOverdueTasks(req.user); }

  @Get('stats')
  getStats(@Query('projectId') projectId?: string) {
    return this.service.getStats(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  @RequirePerm('tasks.create')
  create(@Body() dto: CreateTaskDto, @Request() req) {
    return this.service.create(dto, req.user.id, req.user.role);
  }

  @Patch(':id')
  @RequirePerm('tasks.edit')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Get(':id/assignees')
  getAssignees(@Param('id') id: string) {
    return this.service.getAssignees(id);
  }

  @Post(':id/my-part-done')
  markMyPartDone(@Param('id') id: string, @Body('note') note: string | undefined, @Request() req) {
    return this.service.markMyPartDone(id, req.user, note);
  }

  @Post(':id/approve')
  @RequirePerm('tasks.approve')
  approve(@Param('id') id: string, @Request() req) {
    return this.service.approveTask(id, req.user);
  }

  @Post(':id/return')
  @RequirePerm('tasks.return')
  returnTask(@Param('id') id: string, @Body('reason') reason: string, @Request() req) {
    return this.service.returnTask(id, req.user, reason || 'Требует доработки');
  }

  @Post('bulk')
  @RequirePerm('tasks.bulk')
  bulk(
    @Body('ids') ids: string[],
    @Body('action') action: 'status' | 'delete' | 'assign',
    @Body('value') value: string,
    @Request() req,
  ) {
    return this.service.bulkAction(ids, action, value, req.user);
  }

  @Delete(':id')
  @RequirePerm('tasks.delete')
  remove(
    @Param('id') id: string,
    @Request() req,
    @Body('reason') reasonBody?: string,
    @Query('reason') reasonQuery?: string,
  ) {
    // Wave 3: причина удаления обязательна. Принимаем из body или query.
    return this.service.removeWithAuth(id, req.user, reasonBody ?? reasonQuery);
  }
}
