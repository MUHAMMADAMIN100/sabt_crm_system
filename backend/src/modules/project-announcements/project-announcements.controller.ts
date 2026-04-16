import {
  Controller, Get, Post, Delete, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectAnnouncementsService } from './project-announcements.service';
import { AnnouncementPriority } from './project-announcement.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Project Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/announcements')
export class ProjectAnnouncementsController {
  constructor(private service: ProjectAnnouncementsService) {}

  @Get()
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  create(
    @Param('projectId') projectId: string,
    @Body() dto: { title: string; description?: string; priority?: AnnouncementPriority },
    @Request() req,
  ) {
    return this.service.create(projectId, dto, req.user.id, req.user.name);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
