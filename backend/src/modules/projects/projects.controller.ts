import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { SetDevStageDto } from './dto/set-dev-stage.dto';
import { SetStoriesArchiveDto } from './dto/set-stories-archive.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { UserRole } from '../users/user.entity';
import { ProjectStatus } from './project.entity';

// Fix import
export { UpdateProjectDto } from './dto/create-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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
  @RequirePerm('projects.create')
  create(@Body() dto: CreateProjectDto, @Request() req) {
    return this.service.create(dto, req.user.id, req.user.role, req.user.secondaryRole);
  }

  @Patch(':id')
  @RequirePerm('projects.edit')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  /** Этап разработки на доске «Разработка» ([10%]…[100%]). Доступ уже, чем
   *  projects.edit: pm_dev двигает карточки, не имея права редактировать проект. */
  @Patch(':id/dev-stage')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  setDevStage(@Param('id') id: string, @Body() dto: SetDevStageDto, @Request() req) {
    return this.service.setDevStage(id, dto.devStage, req.user);
  }

  /** Архив историй сторисмейкера (не настоящий архив проекта). Доступ:
   *  сторисмейкер (двигает свой кабинет) + руководитель SMM + топ. */
  @Patch(':id/stories-archive')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.STORYMAKER)
  setStoriesArchived(@Param('id') id: string, @Body() dto: SetStoriesArchiveDto, @Request() req) {
    return this.service.setStoriesArchived(id, dto.archived, req.user);
  }

  /** Настройки месячного цикла SMM-проекта (Умный календарь): день старта
   *  (1..31) + норма за цикл (рилсы/посты). null у поля — сбросить его. */
  @Patch(':id/smm-cycle')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR)
  setSmmCycle(
    @Param('id') id: string,
    @Body() body: { day?: number | null; normReels?: number | null; normPosts?: number | null },
    @Request() req,
  ) {
    return this.service.setSmmCycle(id, body || {}, req.user);
  }

  /** Профиль клиента SMM-проекта: владелец, значимый день (дата + коммент),
   *  начало сотрудничества, предпочтения, история подписчиков по месяцам. */
  @Get(':id/smm-profile')
  getSmmProfile(@Param('id') id: string) {
    return this.service.getSmmProfile(id);
  }

  /** Редактируют только SMM и владелец/руководство. */
  @Patch(':id/smm-profile')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST)
  setSmmProfile(
    @Param('id') id: string,
    @Body() body: { ownerName?: string | null; keyDate?: string | null; keyDateNote?: string | null; collabSince?: string | null; preferences?: string | null; followers?: { ym: string; value: number }[] },
    @Request() req,
  ) {
    return this.service.setSmmProfile(id, body || {}, req.user);
  }

  /** Архив/восстановление — по гранту projects.archive: нативные роли те же,
   *  что раньше в @Roles, плюс персональная выдача через «Доступы
   *  сотрудников» (области ролей сужаются в сервисе). */
  @Patch(':id/archive')
  @RequirePerm('projects.archive')
  archive(@Param('id') id: string, @Request() req) {
    return this.service.archive(id, req.user);
  }

  @Patch(':id/restore')
  @RequirePerm('projects.archive')
  restore(@Param('id') id: string, @Request() req) {
    return this.service.restore(id, req.user);
  }

  @Delete(':id')
  @RequirePerm('projects.delete')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user);
  }

  @Get(':id/payments')
  @RequirePerm('projects.payments.view')
  listPayments(@Param('id') id: string) {
    return this.service.listPayments(id);
  }

  @Post(':id/send-payment-request')
  @RequirePerm('projects.payments.request')
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
  @RequirePerm('projects.launch.manage')
  setManualLaunchItem(
    @Param('id') id: string,
    @Body() body: { item: string; value: boolean },
  ) {
    return this.service.setManualLaunchItem(id, body.item, body.value);
  }

  // ─── Доступы к аккаунтам клиента ──────────────────────────────────
  // Роли перечислены в сервисе (CLIENT_ACCESS_ROLES) и проверяются там же:
  // так правило одно и то же для чтения и для записи, и его нельзя обойти,
  // добавив новую ручку мимо @Roles.
  @Get(':id/client-access')
  getClientAccess(@Param('id') id: string, @Request() req) {
    return this.service.getClientAccess(id, req.user);
  }

  @Patch(':id/client-access')
  saveClientAccess(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.service.saveClientAccess(id, body, req.user);
  }

  // ─── SMM-бриф клиента (вкладка «Бриф» в карточке SMM-проекта) ─────
  @Patch(':id/brief')
  // Менеджеры продаж заполняют бриф клиента при заведении проекта.
  @RequirePerm('projects.brief.manage')
  saveBrief(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req,
  ) {
    return this.service.saveBrief(id, body, req.user);
  }

  @Delete(':id/brief')
  @RequirePerm('projects.brief.clear')
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
    UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV,
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
