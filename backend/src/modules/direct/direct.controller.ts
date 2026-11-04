import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { CreateClientDto } from '../clients/dto/create-client.dto';
import { DirectService } from './direct.service';
import { MAX_DOCUMENT_SIZE, MAX_VOICE_SIZE } from './direct-files';
import {
  DirectCountsQueryDto, DirectListQueryDto, DirectMessagesQueryDto, DirectNoteDto, DirectSendFileDto,
  DirectSendTextDto, DirectStatsQueryDto,
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
 * @RequirePerm стоит на КАЖДОМ методе: PermissionsGuard читает только его.
 */
@ApiTags('Direct')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('direct')
export class DirectController {
  constructor(private readonly direct: DirectService) {}

  @Get('status')
  @RequirePerm('clients.view')
  status(@Request() req: ExpressRequest) {
    return this.direct.status(publicBase(req));
  }

  @Get('unread')
  @RequirePerm('clients.view')
  unread() {
    return this.direct.unreadTotal();
  }

  @Get('stats')
  @RequirePerm('clients.view')
  stats(@Query() query: DirectStatsQueryDto) {
    return this.direct.stats(query.from, query.to);
  }

  @Get('conversations')
  @RequirePerm('clients.view')
  list(@Request() req, @Query() query: DirectListQueryDto) {
    return this.direct.list(req.user, query);
  }

  @Get('counts')
  @RequirePerm('clients.view')
  counts(@Query() query: DirectCountsQueryDto) {
    return this.direct.counts(query.search);
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
    return this.direct.sendText(req.user, id, body.text, publicBase(req));
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
    return this.direct.sendFile(req.user, id, file, body?.text, publicBase(req));
  }

  @Post('conversations/:id/voice')
  @RequirePerm('clients.view')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VOICE_SIZE, files: 1 } }))
  sendVoice(@Request() req, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.direct.sendVoice(req.user, id, file, publicBase(req));
  }

  @Post('messages/:id/retry')
  @RequirePerm('clients.view')
  retry(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.direct.retry(req.user, id, publicBase(req));
  }

  @Post('conversations/:id/notes')
  @RequirePerm('clients.view')
  addNote(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() body: DirectNoteDto) {
    return this.direct.addNote(req.user, id, body.text);
  }

  @Delete('notes/:id')
  @HttpCode(204)
  @RequirePerm('clients.view')
  async deleteNote(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    await this.direct.deleteNote(req.user, id);
  }

  /** «Создать лид» из чата — те же поля, что у формы Базы клиентов. */
  @Post('conversations/:id/lead')
  @RequirePerm('clients.create')
  createLead(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateClientDto) {
    return this.direct.createLead(req.user, id, dto);
  }
}
