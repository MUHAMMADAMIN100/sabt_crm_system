import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RECEIPT_MIME, TransportService } from './transport.service';

const RECEIPT_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Фото чека: в память, а не на диск — файл уходит в БД (диск на Railway
 *  эфемерный). Фронт жмёт фото в JPEG до ~400 КБ, лимит на входе — с запасом. */
const RECEIPT_MULTER_CONFIG = {
  storage: memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const ext = extname(file.originalname || '').toLowerCase();
    // HEIC фронт сам переводит в JPEG; если дошёл сырым — объясняем.
    if (ext === '.heic' || ext === '.heif') {
      return cb(new BadRequestException('Фото в формате HEIC. Сохраните его как JPEG или сделайте скриншот.'), false);
    }
    if (!RECEIPT_EXT.has(ext) || !RECEIPT_MIME.has(file.mimetype)) {
      return cb(new BadRequestException('Фото чека: нужен JPG, PNG или WEBP'), false);
    }
    cb(null, true);
  },
};

/** Транспорт по работе: заявки SMM-специалистов и видеографов на возврат
 *  денег за проезд. Подача и свои заявки — у самих сотрудников; список,
 *  оплата и отказ — у владельца (право finance.manage). */
@ApiTags('Transport')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('transport-requests')
export class TransportController {
  constructor(private service: TransportService) {}

  /** Мои заявки и итоги. */
  @Get('my')
  my(@Request() req) { return this.service.my(req.user); }

  /** Проекты для выбора в заявке — свои первыми. */
  @Get('projects')
  projects(@Request() req) { return this.service.projectsFor(req.user); }

  /** Подать заявку: multipart { projectId, amount, date, note?, receipt? (фото) }. */
  @Post()
  @UseInterceptors(FileInterceptor('receipt', RECEIPT_MULTER_CONFIG))
  create(@Request() req, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    return this.service.create(req.user, body || {}, file);
  }

  /** Отозвать свою неоплаченную заявку. */
  @Delete(':id')
  cancel(@Request() req, @Param('id') id: string) { return this.service.cancel(req.user, id); }

  /** Владелец: ждут оплаты + решённые за месяц. */
  @Get()
  @RequirePerm('finance.manage')
  list(@Query('ym') ym?: string) { return this.service.list(ym); }

  /** Владелец: оплатить — расход «Транспорт» с выбранного счёта. */
  @Post(':id/pay')
  @RequirePerm('finance.manage')
  pay(@Request() req, @Param('id') id: string, @Body() body: any) { return this.service.pay(req.user, id, body || {}); }

  /** Владелец: отклонить с причиной — сотрудник её увидит. */
  @Post(':id/reject')
  @RequirePerm('finance.manage')
  reject(@Request() req, @Param('id') id: string, @Body() body: any) { return this.service.reject(req.user, id, body || {}); }
}
