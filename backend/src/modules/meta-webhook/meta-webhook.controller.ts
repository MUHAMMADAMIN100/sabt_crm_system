import { Controller, Get, Post, Query, Body, HttpCode, Logger, ForbiddenException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Вебхук Meta (WhatsApp / Instagram / Messenger). ПУБЛИЧНЫЙ — без auth-гвардов:
 * Meta обращается к нему напрямую.
 *
 * GET  /api/webhooks/meta — верификация подписки: Meta присылает
 *      hub.mode=subscribe, hub.verify_token и hub.challenge; при совпадении
 *      токена нужно вернуть challenge КАК ЕСТЬ (plain text, 200).
 * POST /api/webhooks/meta — события (входящие сообщения и т.п.). Meta ждёт
 *      быстрый 200, иначе ретраит и в итоге отключает вебхук.
 *
 * Verify Token берётся из env META_VERIFY_TOKEN (Railway → Variables);
 * fallback — значение по умолчанию ниже (можно оставить для старта).
 */
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'sabt_super_secret_token_2026';

@ApiTags('Meta Webhook')
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge != null) {
      this.logger.log('Meta webhook verified (hub.challenge echoed)');
      return challenge;
    }
    this.logger.warn(`Meta webhook verification failed: mode=${mode}, token match=${token === VERIFY_TOKEN}`);
    throw new ForbiddenException('Verification failed');
  }

  @Post()
  @HttpCode(200)
  receive(@Body() body: any): string {
    // Пока только фиксируем событие в логах — обработка сообщений (создание
    // лида/уведомления в CRM) будет следующим шагом интеграции.
    try {
      const object = body?.object;
      const entries = Array.isArray(body?.entry) ? body.entry.length : 0;
      this.logger.log(`Meta event: object=${object}, entries=${entries}`);
      this.logger.debug(JSON.stringify(body).slice(0, 2000));
    } catch { /* не мешаем ответу 200 */ }
    return 'EVENT_RECEIVED';
  }
}
