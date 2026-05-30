import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class CommentBodyDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(10000)
  message: string;
}

@ApiTags('Comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks/:taskId/comments')
export class CommentsController {
  constructor(private service: CommentsService) {}

  @Get()
  findAll(@Param('taskId') taskId: string, @Request() req) {
    return this.service.findByTask(taskId, req.user);
  }

  @Post()
  create(
    @Param('taskId') taskId: string,
    @Body() body: CommentBodyDto,
    @Request() req,
  ) {
    return this.service.create(taskId, body.message, req.user.id, req.user.role);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: CommentBodyDto, @Request() req) {
    return this.service.update(id, body.message, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role);
  }
}
