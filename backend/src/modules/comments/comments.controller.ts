import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks/:taskId/comments')
export class CommentsController {
  constructor(private service: CommentsService) {}

  @Get()
  findAll(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId);
  }

  @Post()
  create(
    @Param('taskId') taskId: string,
    @Body() body: { message: string },
    @Request() req,
  ) {
    return this.service.create(taskId, body.message, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { message: string }, @Request() req) {
    return this.service.update(id, body.message, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role);
  }
}
