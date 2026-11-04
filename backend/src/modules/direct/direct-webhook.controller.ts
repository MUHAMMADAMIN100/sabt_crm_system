import {
  Controller, ForbiddenException, Get, Headers, HttpCode, Logger, NotFoundException, Param, Post, Query, Req, Res,
  UnauthorizedException, type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { DirectService } from './direct.service';
import { DirectFiles, type OpenedFile } from './direct-files';
import { describeWebhook, parseInstagramWebhook } from './instagram-events';
import { signedByMeta } from './meta-http';
import { instagramEnv } from './instagram.api';

/** Типы, которые браузер может показать сам; остальное — на скачивание. */
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/|audio\/|application\/pdf)/;

/** Отдаёт файл через express sendFile: он понимает Range (Safari и iPhone
 *  без ответа 206 не играют <audio>/<video>), ETag и сам закрывает файл,
 *  если зритель ушёл посреди загрузки. */
function send(res: Response, file: OpenedFile, name: string | null, cache: string): void {
  // Тип задаём сами — sendFile не переопределяет уже выставленный.
  res.setHeader('Content-Type', file.type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  const disposition = INLINE.test(file.type) ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', name ? `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}` : disposition);
  res.sendFile(file.path, { cacheControl: false, acceptRanges: true }, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
}

/**
 * Адреса без входа в CRM:
 *  - вебхук Instagram: Meta проверяет адрес словом META_VERIFY_TOKEN и подписывает
 *    каждое уведомление секретом приложения (X-Hub-Signature-256);
 *  - файлы, которые отправляем мы: Instagram скачивает их сам;
 *  - файлы переписки и фото собеседников по подписанной ссылке на сутки
 *    (картинка в <img> не умеет присылать заголовок входа).
 */
@ApiExcludeController()
@SkipThrottle()
@Controller()
export class DirectWebhookController {
  private readonly logger = new Logger(DirectWebhookController.name);

  constructor(
    private readonly direct: DirectService,
    private readonly files: DirectFiles,
  ) {}

  @Get('webhooks/instagram')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expected = instagramEnv().verifyToken;
    if (mode !== 'subscribe' || !expected || token !== expected || !challenge) {
      this.logger.warn(`Проверка адреса вебхука Instagram не прошла (слово ${expected ? (token === expected ? 'совпало' : 'не совпало') : 'не задано'})`);
      throw new ForbiddenException('Verification failed');
    }
    this.logger.log('Адрес вебхука Instagram подтверждён');
    res.type('text/plain').send(challenge);
  }

  /** 200 — только после записи: при сбое Meta повторит доставку. */
  @Post('webhooks/instagram')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined): Promise<string> {
    if (!signedByMeta(req.rawBody, signature, instagramEnv().appSecret)) {
      this.logger.warn('Уведомление Instagram без верной подписи отклонено');
      throw new UnauthorizedException();
    }
    const events = parseInstagramWebhook(req.body);
    // В журнал — форма уведомления, но не слова клиентов.
    if (events.length) this.logger.log(`Instagram: событий ${events.length}`);
    else this.logger.warn(`Instagram: нечего прочитать — ${describeWebhook(req.body)}`);
    await this.direct.receive(events);
    return 'EVENT_RECEIVED';
  }

  @Get('public/direct-files/:name')
  async publicFile(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const file = await this.direct.publicFile(name);
    send(res, file, null, 'public, max-age=86400');
  }

  @Get('direct/media/:id')
  async media(@Param('id') id: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response): Promise<void> {
    if (!this.files.verify('media', id, e, s)) throw new NotFoundException();
    const file = await this.direct.media(id);
    send(res, file, file.name, 'private, max-age=86400');
  }

  @Get('direct/avatar/:id')
  async avatar(@Param('id') id: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response): Promise<void> {
    if (!this.files.verify('avatar', id, e, s)) throw new NotFoundException();
    const file = await this.direct.avatar(id);
    send(res, file, null, 'private, max-age=86400');
  }
}
