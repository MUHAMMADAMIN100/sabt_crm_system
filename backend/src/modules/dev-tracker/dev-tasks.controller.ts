import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { DevTasksService } from './dev-tasks.service';
import { CreateDevTaskDto } from './dto/create-dev-task.dto';
import { UpdateDevTaskDto } from './dto/update-dev-task.dto';
import { MoveDevTaskDto } from './dto/move-dev-task.dto';
import { CommentDevTaskDto } from './dto/comment-dev-task.dto';
import { BulkDevTaskDto } from './dto/bulk-dev-task.dto';
import { TriageOverdueDto } from './dto/triage-overdue.dto';
import { CreateBoardViewDto } from './dto/board-view.dto';
import { CreateSprintDto, UpdateSprintDto, CompleteSprintDto } from './dto/sprint.dto';
import { CreateWebhookDto } from './dto/webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { hasGrant } from '../auth/permissions';
import { DevTaskStatus } from './dev-task.entity';
import { NoCoerce } from './dto/no-coerce.transform';

/** Body для POST /dev-tracker/:id/clone (inline DTO по контракту). */
export class CloneDevTaskDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @NoCoerce()
  @IsBoolean()
  withSubtasks?: boolean;
}

@ApiTags('Dev Tracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('dev-tracker')
export class DevTasksController {
  constructor(private service: DevTasksService) {}

  @Get()
  @RequirePerm('dev-tracker.view')
  findAll(
    @Query('status') status?: DevTaskStatus,
    @Query('assigneeId') assigneeId?: string,
    @Query('search') search?: string,
    @Query('projectId') projectId?: string,
    @Query('tags') tags?: string,
    // Контракт A: ?blocked=true — только заблокированные.
    @Query('blocked') blocked?: string,
    // Контракт H: ?sprint=<uuid> — задачи спринта, ?sprint=none — вне спринтов.
    @Query('sprint') sprint?: string,
  ) {
    // tags — строка через запятую (?tags=frontend,urgent): trim, чистим пустые, уникальные.
    // DoS-кап 20: простыня тегов в query режется (сервис дублирует кап).
    const parsedTags = tags
      ? [...new Set(tags.split(',').map(t => t.trim()).filter(Boolean))].slice(0, 20)
      : undefined;
    // blocked — регистронезависимо (?blocked=True тоже фильтр); мусор значения
    // игнорируем без фильтра (не 400, не 500). Enum/UUID мусора в status/sprint/
    // assignee/project отклоняет 400-кой сам сервис (см. findAll).
    const blockedNorm = blocked?.trim().toLowerCase();
    return this.service.findAll({
      status,
      assigneeId,
      search,
      projectId,
      ...(parsedTags?.length ? { tags: parsedTags } : {}),
      ...(blockedNorm === 'true' ? { blocked: true } : blockedNorm === 'false' ? { blocked: false } : {}),
      // Пустой sprint — как absent (без фильтра); 'none' — задачи вне спринтов.
      ...(sprint ? { sprintId: sprint === 'none' ? null : sprint } : {}),
    });
  }

  // Маршруты объявлены ДО ':id', иначе Nest сматчит 'kpi'/'views'/... как id.
  @Get('kpi')
  @RequirePerm('dev-tracker.view')
  getKpi() {
    return this.service.getKpi();
  }

  /** CFD-поток (контракт F): ?days=30, диапазон 7..90 (иначе 400 из сервиса). */
  @Get('kpi/flow')
  @RequirePerm('dev-tracker.view')
  getFlow(@Query('days') days?: string) {
    return this.service.getFlow(days === undefined || days === '' ? 30 : Number(days));
  }

  /** Шаблонные отчёты для CEO (manage): ?type=week&days=7
   *  | type=sprint&sprintId=<uuid> | type=project&projectId=<uuid>.
   *  Валидация (400/404) — в сервисе. Маршрут ДО ':id', иначе 'reports'
   *  сматчится как id. */
  @Get('reports')
  @RequirePerm('dev-tracker.manage')
  getReport(
    @Query('type') type?: string,
    @Query('days') days?: string,
    @Query('sprintId') sprintId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.getReport({
      type,
      days: days === undefined || days === '' ? 7 : Number(days),
      sprintId,
      projectId,
    });
  }

  /** Свои saved views (контракт D), ORDER createdAt. */
  @Get('views')
  @RequirePerm('dev-tracker.view')
  listViews(@Request() req) {
    return this.service.listViews(req.user.id);
  }

  @Post('views')
  @RequirePerm('dev-tracker.view')
  createView(@Body() dto: CreateBoardViewDto, @Request() req) {
    return this.service.createView(req.user.id, dto);
  }

  /** Удаление view: владелец или dev-tracker.manage (контракт D). */
  @Delete('views/:id')
  @RequirePerm('dev-tracker.view')
  deleteView(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.service.deleteView(id, req.user.id, hasGrant(req.user, 'dev-tracker.manage'));
  }

  /** Лёгкое превью карточки (контракт G). */
  @Get('preview/:id')
  @RequirePerm('dev-tracker.view')
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPreview(id);
  }

  @Get('sprints')
  @RequirePerm('dev-tracker.view')
  listSprints() {
    return this.service.listSprints();
  }

  /** Исполнители для селектов доски — скоупнутый список активных dev-ролей.
   *  Маршрут ДО ':id', иначе 'assignees' сматчится как id. */
  @Get('assignees')
  @RequirePerm('dev-tracker.view')
  listAssignees() {
    return this.service.listAssignees();
  }

  @Post('sprints')
  @RequirePerm('dev-tracker.manage')
  createSprint(@Body() dto: CreateSprintDto, @Request() req) {
    return this.service.createSprint(dto, req.user.id);
  }

  @Patch('sprints/:id')
  @RequirePerm('dev-tracker.manage')
  updateSprint(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSprintDto) {
    return this.service.updateSprint(id, dto);
  }

  /** Завершение спринта (контракт H, manage). */
  @Post('sprints/:id/complete')
  @RequirePerm('dev-tracker.manage')
  completeSprint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSprintDto,
    @Request() req,
  ) {
    return this.service.completeSprint(id, dto.moveTo, req.user.id);
  }

  @Get('webhooks')
  @RequirePerm('dev-tracker.manage')
  listWebhooks() {
    return this.service.listWebhooks();
  }

  @Post('webhooks')
  @RequirePerm('dev-tracker.manage')
  createWebhook(@Body() dto: CreateWebhookDto, @Request() req) {
    return this.service.createWebhook(dto, req.user.id);
  }

  @Delete('webhooks/:id')
  @RequirePerm('dev-tracker.manage')
  deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteWebhook(id);
  }

  /** Тестовый task.done в подписку (контракт E, manage). */
  @Post('webhooks/:id/test')
  @RequirePerm('dev-tracker.manage')
  testWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.testWebhook(id);
  }

  /** Журнал доставок подписки: последние 20, DESC (контракт E, manage). */
  @Get('webhooks/:id/deliveries')
  @RequirePerm('dev-tracker.manage')
  getDeliveries(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getWebhookDeliveries(id);
  }

  /** Триаж просрочки (контракт C, manage). */
  @Post('triage-overdue')
  @RequirePerm('dev-tracker.manage')
  triageOverdue(@Body() dto: TriageOverdueDto, @Request() req) {
    return this.service.triageOverdue(dto ?? {}, req.user.id);
  }

  @Get(':id')
  @RequirePerm('dev-tracker.view')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/history')
  @RequirePerm('dev-tracker.view')
  getHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getHistory(id);
  }

  @Post()
  @RequirePerm('dev-tracker.manage')
  create(@Body() dto: CreateDevTaskDto, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @RequirePerm('dev-tracker.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDevTaskDto, @Request() req) {
    return this.service.update(id, dto, req.user.id);
  }

  /** Перемещение карточки по доске. Намеренно доступно всем с правом
   *  просмотра: исполнитель сам двигает свою карточку по колонкам,
   *  не дожидаясь руководителя. */
  @Patch(':id/move')
  @RequirePerm('dev-tracker.view')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveDevTaskDto,
    @Request() req,
  ) {
    return this.service.move(id, dto.status, dto.position, req.user.id);
  }

  @Post(':id/comments')
  @RequirePerm('dev-tracker.view')
  addComment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDevTaskDto, @Request() req) {
    return this.service.addComment(id, req.user.id, dto.text, dto.mentions);
  }

  @Post(':id/clone')
  @RequirePerm('dev-tracker.manage')
  clone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloneDevTaskDto, @Request() req) {
    return this.service.clone(id, req.user.id, dto?.withSubtasks);
  }

  /** Массовые операции табличного вида: сменить статус/приоритет или удалить
   *  пачку задач. Manage — потому что массово менять чужие задачи может
   *  только руководитель. */
  @Post('bulk')
  @RequirePerm('dev-tracker.manage')
  bulk(@Body() dto: BulkDevTaskDto, @Request() req) {
    // Пустое тело не должно давать 500 на dto.ids: сервис ответит 400.
    const body = dto ?? ({} as BulkDevTaskDto);
    return this.service.bulk(body.ids ?? [], body.action as 'status' | 'priority' | 'assignee' | 'deadline' | 'blocked' | 'delete', body.value ?? '', req?.user?.id);
  }

  @Delete(':id')
  @RequirePerm('dev-tracker.manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
