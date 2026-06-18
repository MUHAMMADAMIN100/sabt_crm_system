import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectAdsService } from './project-ads.service';
import { CreateProjectAdDto } from './dto/create-project-ad.dto';
import { UpdateProjectAdDto } from './dto/update-project-ad.dto';
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
  findAll(@Param('projectId') projectId: string, @Request() req) {
    return this.service.findByProject(projectId, req.user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.TARGETOLOGIST)
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectAdDto,
    @Request() req,
  ) {
    return this.service.create(projectId, dto as any, req.user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.TARGETOLOGIST)
  update(@Param('id') id: string, @Body() dto: UpdateProjectAdDto, @Request() req) {
    return this.service.update(id, dto as any, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.TARGETOLOGIST)
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user);
  }
}
