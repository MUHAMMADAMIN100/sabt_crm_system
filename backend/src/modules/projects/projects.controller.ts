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
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.user?.role);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  create(@Body() dto: CreateProjectDto, @Request() req) {
    return this.service.create(dto, req.user.id, req.user.role);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Patch(':id/archive')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  archive(@Param('id') id: string, @Request() req) {
    return this.service.archive(id, req.user);
  }

  @Patch(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  restore(@Param('id') id: string, @Request() req) {
    return this.service.restore(id, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user);
  }

  @Get(':id/payments')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV, UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR)
  listPayments(@Param('id') id: string) {
    return this.service.listPayments(id);
  }

  @Post(':id/send-payment-request')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  sendPaymentRequest(
    @Param('id') id: string,
    @Body() body: { message?: string },
    @Request() req,
  ) {
    return this.service.sendPaymentRequest(
      id,
      { id: req.user.id, name: req.user.name, role: req.user.role },
      body?.message,
    );
  }

  // ─── Wave 7: Launch Setup checklist ───────────────────────────────
  @Get(':id/launch-checklist')
  getLaunchChecklist(@Param('id') id: string) {
    return this.service.getLaunchChecklist(id);
  }

  @Patch(':id/launch-checklist')
  @Roles(
    UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
    UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR,
  )
  setManualLaunchItem(
    @Param('id') id: string,
    @Body() body: { item: string; value: boolean },
  ) {
    return this.service.setManualLaunchItem(id, body.item, body.value);
  }

  // ─── SMM-бриф клиента (вкладка «Бриф» в карточке SMM-проекта) ─────
  @Patch(':id/brief')
  @Roles(
    UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
    UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR,
    UserRole.SMM_SPECIALIST,
  )
  saveBrief(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req,
  ) {
    return this.service.saveBrief(id, body, req.user);
  }

  @Delete(':id/brief')
  @Roles(
    UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
    UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR,
  )
  clearBrief(@Param('id') id: string, @Request() req) {
    return this.service.clearBrief(id, req.user);
  }

  /** Сгенерировать (или вернуть существующую) публичную ссылку для
   *  клиента — по этой ссылке он заполнит бриф без авторизации. */
  @Post(':id/brief/share-link')
  @Roles(
    UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER,
    UserRole.SMM_DIRECTOR, UserRole.VIDEO_DIRECTOR,
    UserRole.SMM_SPECIALIST,
  )
  async briefShareLink(@Param('id') id: string, @Request() req) {
    const { token } = await this.service.generateBriefShareToken(id, req.user);
    // Базовый URL фронта — берём из заголовка Origin (правильный для CORS-
    // разрешённых доменов) или из APP_URL / CORS_ORIGINS как fallback.
    const origin = req.headers?.origin
      || (process.env.APP_URL || '').trim()
      || (process.env.CORS_ORIGINS || '').split(',')[0]?.trim()
      || 'https://sabt-crm-system-frontend.vercel.app';
    return { token, url: `${origin.replace(/\/+$/, '')}/public/brief/${token}` };
  }
}
