import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContentPlanService } from './content-plan.service';
import { CreateContentPlanDto } from './dto/create-content-plan.dto';
import { UpdateContentPlanDto } from './dto/update-content-plan.dto';
import {
  ContentPlanStatus, ContentApprovalStatus, ContentItemType,
} from './content-plan-item.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

const EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.FOUNDER,
  UserRole.CO_FOUNDER,
  UserRole.SMM_DIRECTOR,
  UserRole.VIDEO_DIRECTOR,
  UserRole.SMM_SPECIALIST,
];

@ApiTags('Content Plan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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

  /** Календарь производства SMM за месяц: публикации + съёмки (раздел СММ).
   *  Только руководящие роли. Объявлено ДО ':id', иначе перехватит вайлдкард. */
  @Get('smm-calendar')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR)
  smmCalendar(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.smmCalendar(from, to);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @RequirePerm('content-plan.create')
  create(@Body() dto: CreateContentPlanDto, @Request() req) {
    return this.service.create(dto as any, req.user?.id);
  }

  @Patch(':id')
  @RequirePerm('content-plan.edit')
  update(@Param('id') id: string, @Body() dto: UpdateContentPlanDto, @Request() req) {
    return this.service.update(id, dto as any, req.user?.id);
  }

  @Delete(':id')
  @RequirePerm('content-plan.delete')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
