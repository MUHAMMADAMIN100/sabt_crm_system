import {
  Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards,
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

  @Get('project/:projectId')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post('project/:projectId')
  create(@Param('projectId') projectId: string, @Body() dto: any, @Request() req) {
    return this.service.create(projectId, dto, req.user);
  }

  @Patch(':id/move')
  move(@Param('id') id: string, @Body() dto: any, @Request() req) {
    return this.service.move(id, dto, req.user);
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
