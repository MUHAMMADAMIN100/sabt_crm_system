import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { ProjectStatus } from './project.entity';

// Fix import
export { UpdateProjectDto } from './dto/create-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private service: ProjectsService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: ProjectStatus,
    @Query('managerId') managerId?: string,
    @Query('archived') archived?: string,
    @Request() req?,
  ) {
    return this.service.findAll(search, status, managerId, archived === 'true', req?.user);
  }

  @Get('stats')
  getStats() { return this.service.getStats(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  create(@Body() dto: CreateProjectDto, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Patch(':id/archive')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  archive(@Param('id') id: string) { return this.service.archive(id); }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  restore(@Param('id') id: string) { return this.service.restore(id); }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
