import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Request, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { CreateClientDto } from '../clients/dto/create-client.dto';
import { DirectService } from './direct.service';
import { DirectToolsService } from './direct-tools.service';
import { MAX_DOCUMENT_SIZE, MAX_VOICE_SIZE } from './direct-files';
import {
  DirectAssignDto, DirectCountsQueryDto, DirectLabelDto, DirectLabelUpdateDto, DirectListQueryDto, DirectMessagesQueryDto,
  DirectNoteDto, DirectReminderDto, DirectSearchQueryDto, DirectSendFileDto, DirectSendTextDto, DirectSendVoiceDto,
  DirectSetLabelsDto, DirectStatsQueryDto, DirectTemplateDto, DirectTemplateUpdateDto, DirectToggleDto,
} from './direct.dto';

/** Адрес, по которому Instagram скачивает наши файлы: из переменной
 *  PUBLIC_API_URL или из адреса, на который пришёл запрос (Railway). */
export function publicBase(req: ExpressRequest): string {
  const fixed = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  return fixed || `${req.protocol}://${req.get('host')}`;
}

/**
 * «Директ» для сотрудников. Доступ — как у Базы клиентов (clients.view):
 * админ, основатель, оба менеджера продаж и те, кому выдан доступ лично.
 * Писать в закреплённый чат может только тот, кто его ведёт, и руководство
 * (direct-access.ts) — это проверяет сервис.
 * @RequirePerm стоит на КАЖДОМ методе: PermissionsGuard читает только его.
 */
@ApiTags('Direct')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('direct')
export class DirectController {
  constructor(private readonly direct: DirectService, private readonly tools: DirectToolsService) {}

  @Get('status')
  @RequirePerm('clients.view')
  status(@Request() req: ExpressRequest) {
    return this.direct.status(publicBase(req));
  }

  @Get('unread')
  @RequirePerm('clients.view')
  unread(@Request() req) {
    return this.direct.unreadTotal(req.user);
  }

  /** «Аналитика» по менеджерам — только руководству (решение владельца 06.11.2026). */
  @Get('stats')
  @RequirePerm('clients.view')
  stats(@Request() req, @Query() query: DirectStatsQueryDto) {
    return this.direct.stats(req.user, query.from, query.to);
  }

  @Get('conversations')
  @RequirePerm('clients.view')
  list(@Request() req, @Query() query: DirectListQueryDto) {
    return this.direct.list(req.user, query);
  }

  @Get('counts')
  @RequirePerm('clients.view')
  counts(@Request() req, @Query() query: DirectCountsQueryDto) {
    return this.direct.counts(req.user, query);
  }

  /** Поиск по тексту сообщений и заметок. */
  @Get('search')
  @RequirePerm('clients.view')
  search(@Query() query: DirectSearchQueryDto) {
    return this.direct.search(query.q, query.conversationId);
  }

  /** Кто видит «Директ» — для @упоминаний в заметках. */
  @Get('team')
  @RequirePerm('clients.view')
  team() {
    return this.direct.team();
  }

  // ─── Метки ─────────────────────────────────────────────────────────
  @Get('labels')
  @RequirePerm('clients.view')
  labels() {
    return this.tools.labels();
  }

  @Post('labels')
  @RequirePerm('clients.view')
  createLabel(@Request() req, @Body() dto: DirectLabelDto) {
    return this.tools.createLabel(req.user, dto);
  }

  @Patch('labels/:id')
  @RequirePerm('clients.view')
  updateLabel(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DirectLabelUpdateDto) {
    return this.tools.updateLabel(req.user, id, dto);
  }

  @Delete('labels/:id')
  @RequirePerm('clients.view')
  deleteLabel(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.tools.deleteLabel(req.user, id);
  }

  // ─── Шаблоны быстрых ответов ───────────────────────────────────────
  @Get('templates')
  @RequirePerm('clients.view')
  templates(@Request() req) {
    return this.tools.templates(req.user);
  }

  @Post('templates')
  @RequirePerm('clients.view')
  createTemplate(@Request() req, @Body() dto: DirectTemplateDto) {
    return this.tools.createTemplate(req.user, dto);
  }

  @Patch('templates/:id')
  @RequirePerm('clients.view')
  updateTemplate(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DirectTemplateUpdateDto) {
    return this.tools.updateTemplate(req.user, id, dto);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @RequirePerm('clients.view')
  async deleteTemplate(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    await this.tools.deleteTemplate(req.user, id);
  }

  // ─── Напоминания ───────────────────────────────────────────────────
  @Get('reminders')
  @RequirePerm('clients.view')
  reminders(@Request() req) {
    return this.tools.myReminders(req.user);
  }

  @Post('conversations/:id/reminders')
  @RequirePerm('clients.view')
  setReminder(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DirectReminderDto) {
    return this.tools.setReminder(req.user, id, dto);
  }

  @Delete('reminders/:id')
  @RequirePerm('clients.view')
  removeReminder(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.tools.removeReminder(req.user, id);
  }

  /** Менеджеры продаж: кому передать чат, по кому фильтровать список. */
  @Get('managers')
  @RequirePerm('clients.view')
  managers() {
    return this.direct.managers();
  }

  @Get('conversations/:id')
  @RequirePerm('clients.view')
  get(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.direct.get(req.user, id);
  }

  @Get('conversations/:id/messages')
  @RequirePerm('clients.view')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: DirectMessagesQueryDto) {
    return this.direct.messages(id, query);
  }

  /** Правая панель: лид с контактами, фото и файлы, заметки, напоминания. */
  @Get('conversations/:id/details')
  @RequirePerm('clients.view')
  details(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.direct.details(req.user, id);
  }

  @Post('conversations/:id/pin')
  @RequirePerm('clients.view')
  pin(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectToggleDto) {
    return this.direct.setPinned(req.user, id, body.on);
  }

  @Post('conversations/:id/archive')
  @RequirePerm('clients.view')
  archive(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectToggleDto) {
    return this.direct.setArchived(req.user, id, body.on);
  }

  /** «Пометить непрочитанным» (on) или снять отметку. */
  @Post('conversations/:id/unread')
  @RequirePerm('clients.view')
  markUnread(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectToggleDto) {
    return this.direct.setMarkedUnread(req.user, id, body.on);
  }

  @Put('conversations/:id/labels')
  @RequirePerm('clients.view')
  setLabels(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectSetLabelsDto) {
    return this.direct.setLabels(req.user, id, body.labelIds);
  }

  /** «Печатает…» у клиента. */
  @Post('conversations/:id/typing')
  @HttpCode(204)
  @RequirePerm('clients.view')
  async typing(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    await this.direct.typing(req.user, id);
  }

  /** Реакция ❤️ на сообщение клиента. */
  @Post('messages/:id/react')
  @RequirePerm('clients.view')
  react(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectToggleDto) {
    return this.direct.react(req.user, id, body.on);
  }

  /** Открыл чат: прочитано. */
  @Post('conversations/:id/read')
  @HttpCode(204)
  @RequirePerm('clients.view')
  async read(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    await this.direct.markRead(req.user, id);
  }

  /** Пульс открытого чата — «сейчас в чате: Имя». */
  @Post('conversations/:id/viewing')
  @HttpCode(204)
  @RequirePerm('clients.view')
  viewing(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    this.direct.ping(req.user.id, id);
  }

  @Post('conversations/:id/leave')
  @HttpCode(204)
  @RequirePerm('clients.view')
  leave(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    this.direct.leave(req.user.id, id);
  }

  @Post('conversations/:id/messages')
  @RequirePerm('clients.view')
  send(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectSendTextDto) {
    return this.direct.sendText(req.user, id, body.text, publicBase(req), body.clientId, body.replyToId);
  }

  @Post('conversations/:id/files')
  @RequirePerm('clients.view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1 } }))
  sendFile(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: DirectSendFileDto,
  ) {
    return this.direct.sendFile(req.user, id, file, body?.text, publicBase(req), body?.clientId, body?.replyToId);
  }

  @Post('conversations/:id/voice')
  @RequirePerm('clients.view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VOICE_SIZE, files: 1 } }))
  sendVoice(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: DirectSendVoiceDto,
  ) {
    return this.direct.sendVoice(req.user, id, file, publicBase(req), body?.clientId);
  }

  @Post('messages/:id/retry')
  @RequirePerm('clients.view')
  retry(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.direct.retry(req.user, id, publicBase(req));
  }

  @Post('conversations/:id/notes')
  @RequirePerm('clients.view')
  addNote(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectNoteDto) {
    return this.direct.addNote(req.user, id, body.text, body.clientId, body.mentions);
  }

  @Delete('notes/:id')
  @HttpCode(204)
  @RequirePerm('clients.view')
  async deleteNote(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    await this.direct.deleteNote(req.user, id);
  }

  /** Передать чат менеджеру продаж или освободить. Руководство — любой,
   *  менеджер — только свой (проверяет сервис). */
  @Post('conversations/:id/assign')
  @RequirePerm('clients.view')
  assign(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectAssignDto) {
    return this.direct.assign(req.user, id, body.userId ?? null);
  }

  /** «Создать лид» из чата — те же поля, что у формы Базы клиентов. */
  @Post('conversations/:id/lead')
  @RequirePerm('clients.create')
  createLead(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateClientDto) {
    return this.direct.createLead(req.user, id, dto);
  }
}
