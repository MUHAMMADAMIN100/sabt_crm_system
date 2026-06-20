import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WorkflowService } from './workflow.service';

/** Доска «Процесс работы» SMM-проекта: канбан производственных этапов
 *  (контент-план → съёмка → монтаж → ... → реклама).
 *  Просмотр — все авторизованные с доступом к проекту; редактирование
 *  проверяется в сервисе (привилегированные роли / менеджер / участник). */
@Controller('workflow')
@UseGuards(AuthGuard('jwt'))
export class WorkflowController {
  constructor(private service: WorkflowService) {}

  /** Глобальная доска — карточки со всех доступных SMM-проектов. */
  @Get('all')
  listAll(@Request() req) {
    return this.service.listAll(req.user);
  }

  /** Все исполнители по ролям (для селекта видеографов/дизайнеров). */
  @Get('assignees')
  assignees(@Query('roles') roles?: string) {
    return this.service.assignees((roles || '').split(',').map(s => s.trim()).filter(Boolean));
  }

  @Get('project/:projectId')
  list(@Param('projectId') projectId: string, @Request() req) {
    return this.service.list(projectId, req.user);
  }

  @Post('project/:projectId')
  create(@Param('projectId') projectId: string, @Body() dto: any, @Request() req) {
    return this.service.create(projectId, dto, req.user);
  }

  /** M3: сгенерировать план месяца из тарифа (рилсы + макеты). */
  @Post('project/:projectId/generate-plan')
  generatePlan(@Param('projectId') projectId: string, @Body() body: { month?: string }, @Request() req) {
    return this.service.generatePlan(projectId, body?.month, req.user);
  }

  /** Контент-план: сохранить КП → создать карточки «Рилсы»/«Макеты». */
  @Post('project/:projectId/content-plan')
  saveContentPlan(@Param('projectId') projectId: string, @Body() body: { reels?: any[]; macros?: any[] }, @Request() req) {
    return this.service.saveContentPlan(projectId, body || {}, req.user);
  }

  /** Обновить элементы групповой карточки (заполнение полей на этапах). */
  @Patch(':id/items')
  updateItems(@Param('id') id: string, @Body() body: { items?: any[] }, @Request() req) {
    return this.service.updateItems(id, body?.items || [], req.user);
  }

  /** Вынести один элемент группы как отдельную карточку на следующий этап. */
  @Post(':id/item/:itemId/advance')
  advanceItem(@Param('id') id: string, @Param('itemId') itemId: string, @Request() req) {
    return this.service.advanceItem(id, itemId, req.user);
  }

  /** §9.1/§9.2: сгруппировать рилсы в съёмку + пакетно подтвердить съёмку. */
  @Post('project/:projectId/shoot-session')
  createShootSession(@Param('projectId') projectId: string, @Body() body: any, @Request() req) {
    return this.service.createShootSession(projectId, body || {}, req.user);
  }

  @Patch(':id/move')
  move(@Param('id') id: string, @Body() dto: any, @Request() req) {
    return this.service.move(id, dto, req.user);
  }

  /** Движок переходов: действие выхода этапа (ТЗ §10). */
  @Post(':id/transition')
  transition(@Param('id') id: string, @Body() body: { action: string; payload?: any }, @Request() req) {
    return this.service.transition(id, body?.action, body?.payload || {}, req.user);
  }

  /** Журнал событий карточки (история для «Готово к публикации»). */
  @Get(':id/events')
  events(@Param('id') id: string, @Request() req) {
    return this.service.events(id, req.user);
  }

  /** §11: настройка отступов дедлайнов (дни до публикации). */
  @Get('settings/deadlines')
  getDeadlines() {
    return this.service.getDeadlineOffsets();
  }

  @Patch('settings/deadlines')
  setDeadlines(@Body() body: any, @Request() req) {
    return this.service.updateDeadlineOffsets(body || {}, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any, @Request() req) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user);
  }
}
