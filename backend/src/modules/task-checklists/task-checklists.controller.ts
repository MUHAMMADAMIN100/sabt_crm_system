import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TaskChecklistsService } from './task-checklists.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Task Checklists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks/:taskId/checklist')
export class TaskChecklistsController {
  constructor(private service: TaskChecklistsService) {}

  @Get()
  findAll(@Param('taskId') taskId: string, @Request() req) {
    // Проверка доступа к задаче (15.11.2026).
    return this.service.findByTask(taskId, req.user);
  }

  @Post()
  create(
    @Param('taskId') taskId: string,
    @Body('text') text: string,
    @Request() req,
  ) {
    return this.service.create(taskId, text, req.user.id, req.user.role, req.user.secondaryRole);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string, @Request() req) {
    return this.service.toggle(id, req.user.id, req.user.role, req.user.secondaryRole);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body('text') text: string, @Request() req) {
    return this.service.update(id, text, req.user.id, req.user.role, req.user.secondaryRole);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role, req.user.secondaryRole);
  }
}
