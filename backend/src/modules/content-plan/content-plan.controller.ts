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

  /** «Мои задачи производства» — карточки, где я исполнитель: съёмки у
   *  видеографа, монтаж у монтажёра, макеты у дизайнера. Роль не проверяем:
   *  отбор идёт по назначению, чужого человек не увидит. Отдельный эндпоинт
   *  нужен, чтобы не открывать дизайнеру календарь всего агентства. */
  @Get('my-work')
  myWork(@Request() req, @Query('from') from: string, @Query('to') to: string) {
    return this.service.myWork(req.user.id, from, to);
  }

  /** Кому руководитель видеографии может передать съёмку. */
  @Get('shoot-assignees')
  shootAssignees(@Request() req) {
    return this.service.shootAssignees(req.user);
  }

  /** Назначить основного видеографа: за ним закрепляются новые съёмки, а
   *  будущие незакрытые разово переезжают к нему. */
  @Patch('default-videographer')
  setDefaultVideographer(@Request() req, @Body() body: { userId?: string | null }) {
    return this.service.setDefaultVideographer(body?.userId ?? null, req.user);
  }

  /** Передать съёмку другому видеографу (или оставить у себя — userId=null).
   *  Право проверяется в сервисе: исполнитель своей съёмки, руководитель, топ. */
  @Patch('shoot/:id/assignee')
  reassignShoot(@Request() req, @Param('id') id: string, @Body() body: { userId?: string | null }) {
    return this.service.reassignShoot(id, body?.userId ?? null, req.user);
  }

  /** Своя карточка: отметка «готово/не готово» и перенос на другой день.
   *  Только эти два действия и только у своей — поэтому это не smart-item,
   *  закрытый ролями СММ. Отмена задачи исполнителю не даётся. */
  @Patch('my-work/:id')
  updateMyWork(@Request() req, @Param('id') id: string, @Body() body: { done?: boolean; date?: string }) {
    return this.service.updateMyWork(req.user.id, id, body || {});
  }

  @Get('plan-fact/:projectId')
  getPlanFact(@Param('projectId') projectId: string) {
    return this.service.getPlanFactByProject(projectId);
  }

  /** Календарь производства за месяц: публикации + съёмки. Разделы «СММ» и
   *  «Разработка» (segment=dev — те же механики, но dev-проекты), поэтому
   *  помимо SMM-ролей допущена команда разработки. Объявлено ДО ':id',
   *  иначе перехватит вайлдкард. */
  @Get('smm-calendar')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  smmCalendar(@Query('from') from?: string, @Query('to') to?: string, @Query('segment') segment?: string) {
    return this.service.smmCalendar(from, to, segment === 'dev' ? 'dev' : 'smm');
  }

  /** Перенос старой съёмочной сессии (наследие «Доски проектов») по датам —
   *  drag в умном календаре. Литеральный сегмент объявлен ДО ':id'. */
  @Patch('shoot-session/:id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  updateShootSession(@Param('id') id: string, @Body() body: any) {
    return this.service.updateShootSession(id, body || {});
  }

  /** Умный календарь: догенерировать заготовки под норму цикла (рилсы/посты)
   *  в «Не запланировано». Руководящие роли SMM + команда разработки. */
  @Post('smart-generate')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  smartGenerate(@Body() body: { projectId: string; reels?: number; posts?: number }) {
    return this.service.smartGenerateStubs(body?.projectId, body?.reels ?? 0, body?.posts ?? 0);
  }

  /** Умный календарь: полностью очистить контент проекта (сброс теста). */
  @Post('smart-clear')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  smartClear(@Body() body: { projectId: string }) {
    return this.service.smartClearProject(body?.projectId);
  }

  /** Умный календарь: быстрый апдейт позиции (перенос даты / статус) без
   *  побочных эффектов. Объявлено ДО ':id'. Руководящие роли SMM + разработка. */
  @Patch('smart-item/:id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST, UserRole.DEV_DIRECTOR, UserRole.PM_DEV, UserRole.DEVELOPER)
  smartUpdateItem(@Param('id') id: string, @Body() body: { publishDate?: string | null; status?: ContentPlanStatus; publishTime?: string | null; durationMin?: number | null }, @Request() req) {
    return this.service.smartUpdateItem(id, body || {}, { id: req.user?.id, name: req.user?.name });
  }

  /** История задачи: перенос, закрытие, отмена. Видна всем, кто видит задачу. */
  @Get('item/:id/history')
  itemHistory(@Param('id') id: string) { return this.service.itemHistory(id); }

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
