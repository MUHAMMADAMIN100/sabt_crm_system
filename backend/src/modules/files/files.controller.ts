import { Controller, Get, Post, Delete, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private service: FilesService) {}

  @Get('project/:projectId')
  byProject(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Get('task/:taskId')
  byTask(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
    @Query('projectId') projectId?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.service.upload(file, req.user.id, projectId, taskId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
