import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TaskResultsService } from './task-results.service';
import { CreateTaskResultDto } from './dto/create-task-result.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Task Results')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks/:taskId/results')
export class TaskResultsController {
  constructor(private service: TaskResultsService) {}

  @Get()
  findAll(@Param('taskId') taskId: string, @Request() req) {
    // Проверка доступа к задаче (15.11.2026).
    return this.service.findByTask(taskId, req.user);
  }

  @Post()
  create(
    @Param('taskId') taskId: string,
    @Body() dto: CreateTaskResultDto,
    @Request() req,
  ) {
    return this.service.create(taskId, req.user.id, req.user.role, dto, req.user.secondaryRole);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role, req.user.secondaryRole);
  }
}
