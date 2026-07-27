import { Controller, Get, Post, Delete, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('files')
export class FilesController {
  constructor(private service: FilesService) {}

  @Get('project/:projectId')
  @RequirePerm('files.view')
  byProject(@Param('projectId') projectId: string, @Request() req) {
    return this.service.findByProject(projectId, req.user);
  }

  @Get('task/:taskId')
  @RequirePerm('files.view')
  byTask(@Param('taskId') taskId: string, @Request() req) {
    return this.service.findByTask(taskId, req.user);
  }

  @Post('upload')
  @RequirePerm('files.upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
    @Query('projectId') projectId?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.service.upload(file, req.user.id, req.user.role, projectId, taskId);
  }

  @Delete(':id')
  @RequirePerm('files.delete')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id, req.user.role);
  }
}
