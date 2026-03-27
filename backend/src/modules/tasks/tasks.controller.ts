import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
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

  @Get('my')
  getMyTasks(@Request() req) {
    return this.service.getMyTasks(req.user.id);
  }

  @Get('overdue')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getOverdue() { return this.service.getOverdueTasks(); }

  @Get('stats')
  getStats(@Query('projectId') projectId?: string) {
    return this.service.getStats(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateTaskDto, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
