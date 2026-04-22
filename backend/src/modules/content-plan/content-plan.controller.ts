import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContentPlanService } from './content-plan.service';
import {
  ContentPlanStatus, ContentApprovalStatus, ContentItemType,
} from './content-plan-item.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

const EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.FOUNDER,
  UserRole.CO_FOUNDER,
  UserRole.PROJECT_MANAGER,
  UserRole.HEAD_SMM,
  UserRole.SMM_SPECIALIST,
];

@ApiTags('Content Plan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('content-plan')
export class ContentPlanController {
  constructor(private service: ContentPlanService) {}

  /** Список — любой авторизованный (фильтрация на стороне UI по доступному проекту).
   *  TODO: добавить фильтрацию по доступным проектам пользователя на сервере. */
  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: ContentPlanStatus,
    @Query('approvalStatus') approvalStatus?: ContentApprovalStatus,
    @Query('assigneeId') assigneeId?: string,
    @Query('contentType') contentType?: ContentItemType,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll({ projectId, status, approvalStatus, assigneeId, contentType, from, to });
  }

  @Get('plan-fact/:projectId')
  getPlanFact(@Param('projectId') projectId: string) {
    return this.service.getPlanFactByProject(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(...EDIT_ROLES)
  create(@Body() dto: any) { return this.service.create(dto); }

  @Patch(':id')
  @Roles(...EDIT_ROLES)
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.PROJECT_MANAGER, UserRole.HEAD_SMM)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
