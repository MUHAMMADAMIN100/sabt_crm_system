import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';

/** Утренняя сводка производству. Живёт ОТДЕЛЬНЫМ модулем намеренно: если
 *  повесить её на ContentPlanService, получается кольцо модулей
 *  ContentPlan → Telegram → Tasks → Projects → ContentPlan, и приложение
 *  не стартует. Этот модуль не импортирует никто, поэтому кольца нет. */
@Injectable()
export class ProductionDigestService {
  private readonly logger = new Logger(ProductionDigestService.name);

  constructor(
    @InjectRepository(ContentPlanItem) private repo: Repository<ContentPlanItem>,
    private telegram: TelegramService,
    private notifications: NotificationsService,
  ) {}

  /** 9:00 по Душанбе: каждому исполнителю — что у него сегодня. Именно это и
   *  значит «задачи приходят сами»: человек не заходит проверять кабинет.
   *  Шлём только тем, у кого есть незакрытые карточки: пустые «задач нет»
   *  быстро приучают не читать уведомления. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyProductionMorning() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
    const rows: any[] = await this.repo.manager.query(
      `SELECT ci."assigneeId" AS "userId", ci."prepStage" AS stage, ci."publishTime" AS time,
              p.name AS "projectName", COALESCE(parent.topic, ci.topic) AS title,
              parent."contentType" AS "parentType"
       FROM content_plan_items ci
       JOIN projects p ON p.id = ci."projectId"
       LEFT JOIN content_plan_items parent ON parent.id = ci."shootForItemId"
       WHERE ci."assigneeId" IS NOT NULL
         AND ci."publishDate"::date = ($1)::date
         AND ci.status NOT IN ('published', 'cancelled')
       ORDER BY ci."publishTime" NULLS LAST`,
      [today],
    ).catch((e: any) => { this.logger.warn(`Сводка производству: запрос упал — ${e?.message || e}`); return []; });

    if (!rows.length) return;

    const LABEL: Record<string, string> = { shoot: 'Съёмка', edit: 'Монтаж', design: 'Дизайн' };
    const byUser = new Map<string, any[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) || [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    for (const [userId, list] of byUser) {
      const lines = list.slice(0, 15).map(r => {
        const stage = LABEL[r.stage] || (r.parentType === 'post' ? 'Дизайн' : 'Задача');
        const time = r.time ? ` · ${r.time}` : '';
        return `• <b>${stage}</b>: ${r.title || 'без названия'} — ${r.projectName}${time}`;
      });
      const more = list.length - lines.length;
      const text =
        `🎬 <b>Задачи на сегодня — ${list.length}</b>\n\n` +
        lines.join('\n') +
        (more > 0 ? `\n…и ещё ${more}` : '') +
        `\n\n👉 ${this.telegram.appUrl}/`;

      try {
        await this.telegram.sendToUser(userId, text);
      } catch (e) {
        this.logger.warn(`Telegram-сводка не ушла ${userId}: ${(e as Error).message}`);
      }
      try {
        await this.notifications.create({
          userId,
          type: NotificationType.NEW_TASK,
          title: `Задачи на сегодня — ${list.length}`,
          message: lines.slice(0, 3).map(l => l.replace(/<\/?b>/g, '')).join('; '),
          link: '/',
        });
      } catch (e) {
        this.logger.warn(`Уведомление-сводка не создано ${userId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Утренняя сводка производству: ${byUser.size} чел.`);
  }
}
