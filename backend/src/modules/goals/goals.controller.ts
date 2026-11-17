import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GoalsService } from './goals.service';

/**
 * «Компас компании» (16.11.2026, docs/GOALS_SPEC.md §7). Открыт всем
 * сотрудникам: кто что видит и правит — проверяет сервис (goals-access.ts).
 * Цели месяца сотрудников живут в profile-stats (/goals/*) и здесь не
 * трогаются.
 */
@ApiTags('Compass')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compass')
export class GoalsController {
  constructor(private service: GoalsService) {}

  /** Главный экран: цели компании, отделы, «Требует внимания», моя цепочка. */
  @Get()
  view(@Query('ym') ym: string, @Request() req: any) {
    return this.service.compass(req.user, ym);
  }

  @Get('departments/:key')
  department(@Param('key') key: string, @Query('ym') ym: string, @Request() req: any) {
    return this.service.department(req.user, key, ym);
  }

  @Get('sources')
  sources() {
    return this.service.sources();
  }

  /** «Сейчас по этому источнику: N» — ?source=&ym=&direction=&kpiKey=&department= */
  @Get('sources/preview')
  preview(@Query() q: any, @Request() req: any) {
    return this.service.preview(req.user, q);
  }

  @Post('objectives')
  createObjective(@Body() body: any, @Request() req: any) {
    return this.service.createObjective(req.user, body);
  }

  @Patch('objectives/:id')
  updateObjective(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.updateObjective(req.user, id, body);
  }

  @Delete('objectives/:id')
  deleteObjective(@Param('id') id: string, @Request() req: any) {
    return this.service.deleteObjective(req.user, id);
  }

  @Post('key-results')
  createKeyResult(@Body() body: any, @Request() req: any) {
    return this.service.createKeyResult(req.user, body);
  }

  @Patch('key-results/:id')
  updateKeyResult(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.updateKeyResult(req.user, id, body);
  }

  @Delete('key-results/:id')
  deleteKeyResult(@Param('id') id: string, @Request() req: any) {
    return this.service.deleteKeyResult(req.user, id);
  }

  /** Отметка текущей недели: { status, comment? }. */
  @Post('key-results/:id/checkin')
  checkinOne(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.checkinOne(req.user, id, body);
  }

  /** Привязать проект или задачу: { kind, refId }. */
  @Post('key-results/:id/initiatives')
  addInitiative(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.addInitiative(req.user, id, body);
  }

  @Delete('initiatives/:id')
  removeInitiative(@Param('id') id: string, @Request() req: any) {
    return this.service.removeInitiative(req.user, id);
  }

  /** Разложить «Выигранные сделки» по менеджерам: { items: [{ userId, target }] }. */
  @Post('key-results/:id/distribute')
  distribute(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.service.distribute(req.user, id, body);
  }

  @Get('checkin')
  checkinForm(@Request() req: any) {
    return this.service.checkinForm(req.user);
  }

  /** Отметки недели разом: { items: [{ keyResultId, status, comment? }] }. */
  @Post('checkin')
  submitCheckin(@Body() body: any, @Request() req: any) {
    return this.service.submitCheckin(req.user, body);
  }

  /** Перенести цели прошлого месяца: { fromYm, toYm }. */
  @Post('copy-month')
  copyMonth(@Body() body: any, @Request() req: any) {
    return this.service.copyMonth(req.user, body);
  }

  @Get('settings')
  settings(@Request() req: any) {
    return this.service.settings(req.user);
  }

  /** { leaders: { sales?: userId | null, … } } — null возвращает руководителя по умолчанию. */
  @Put('settings')
  saveSettings(@Body() body: any, @Request() req: any) {
    return this.service.saveSettings(req.user, body);
  }

  @Get('people')
  people(@Query('search') search: string, @Request() req: any) {
    return this.service.people(req.user, search);
  }
}
