import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContentPlanService } from './content-plan.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1] || ''}`;
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};

/**
 * «Каждый цикл — так же, автоматически» (авторасстановка, 06.10.2026).
 * Каждое утро смотрим, у каких проектов с включённым флагом начался новый
 * цикл, расставляем публикации по правилам проекта и просим специалистов
 * проверить. Один цикл — один раз (smmData.autoPlan.lastCycle).
 */
@Injectable()
export class SmmAutoPlanScheduler {
  private readonly logger = new Logger(SmmAutoPlanScheduler.name);

  constructor(
    private readonly contentPlan: ContentPlanService,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'Asia/Dushanbe' })
  async run() {
    const done = await this.contentPlan.autoPlanTick().catch(e => {
      this.logger.warn(`autoPlanTick failed: ${e?.message || e}`);
      return [];
    });
    for (const r of done) {
      if (!r.placed) continue;
      const title = `Публикации расставлены: ${r.projectName}`;
      const message = `${r.placed} ${plural(r.placed, 'публикация', 'публикации', 'публикаций')} на цикл `
        + `${day(r.window.start)} – ${day(r.window.end)} по правилам проекта. Проверьте в календаре.`;
      for (const userId of r.notify) {
        await this.notifications.create({
          userId, type: NotificationType.REVIEW_NEEDED, title, message, link: '/smm',
        } as any).catch(() => undefined);
        await this.telegram.sendToUser(
          userId,
          `🗓 <b>${esc(title)}</b>\n${esc(message)}\n\n👉 ${this.telegram.appUrl}/smm`,
        ).catch(() => undefined);
      }
    }
  }
}
