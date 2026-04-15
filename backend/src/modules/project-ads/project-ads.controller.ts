import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectAdsService } from './project-ads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Project Ads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/ads')
export class ProjectAdsController {
  constructor(private service: ProjectAdsService) {}

  @Get()
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  create(
    @Param('projectId') projectId: string,
    @Body() dto: any,
    @Request() req,
  ) {
    return this.service.create(projectId, dto, req.user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
