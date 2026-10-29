import { BadRequestException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import {
  ProducerShoot, addDays, dailyMessage, nextWeek, readScriptToken, ruLongDay, ruRange, scriptToken, weeklyMessage,
} from './producer.logic';

const TZ = 'Asia/Dushanbe';
const dushanbeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

/** Продюсер (29.10.2026, вариант А): съёмки всех SMM-проектов — ему, без
 *  назначения на проект (продюсер в команде один, как видеограф). Отдельный
 *  модуль по той же причине, что и сводка производству: Telegram в
 *  зависимостях ContentPlanModule замкнул бы кольцо модулей. */
@Injectable()
export class ProducerService {
  private readonly logger = new Logger(ProducerService.name);

  constructor(
    private ds: DataSource,
    private telegram: TelegramService,
    private notifications: NotificationsService,
  ) {}

  private get secret() {
    return process.env.JWT_SECRET || 'dev-secret';
  }

  scriptUrl(s: Pick<ProducerShoot, 'scriptItemId'>) {
    return `${this.telegram.appUrl}/public/script/${scriptToken(s.scriptItemId, this.secret)}`;
  }

  /** Съёмки SMM-проектов за дни «с — по». Съёмка — карточка подготовки
   *  этапа «съёмка»; у старых карточек без этапа съёмкой считается всё,
   *  что не обложка поста (как в кабинете производства). */
  async shoots(from: string, to: string): Promise<ProducerShoot[]> {
    const rows: any[] = await this.ds.query(
      `SELECT ci.id, to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS date, ci."publishTime" AS time,
              p.name AS "projectName", COALESCE(parent.topic, ci.topic) AS title,
              au.name AS videographer,
              COALESCE(parent.id, ci.id) AS "scriptItemId",
              btrim(COALESCE(CASE WHEN parent.id IS NOT NULL THEN parent."scriptText" ELSE ci."scriptText" END, '')) <> '' AS "hasScript",
              ci.status::text = 'published' AS done
         FROM content_plan_items ci
         JOIN projects p ON p.id = ci."projectId"
         LEFT JOIN content_plan_items parent ON parent.id = ci."shootForItemId"
         LEFT JOIN users au ON au.id = ci."assigneeId"
        WHERE p."projectType" = 'SMM' AND COALESCE(p."isArchived", false) = false
          AND COALESCE(p.status::text, '') <> 'archived'
          AND ci."publishDate" IS NOT NULL
          AND ci."publishDate"::date >= ($1)::date AND ci."publishDate"::date <= ($2)::date
          AND ci.status::text <> 'cancelled'
          AND COALESCE(parent.status::text, '') <> 'cancelled'
          AND (ci."prepStage" = 'shoot'
               OR (ci."prepStage" IS NULL AND ci."shootForItemId" IS NOT NULL
                   AND COALESCE(parent."contentType"::text, '') <> 'post'))
        ORDER BY ci."publishDate" ASC, ci."publishTime" ASC NULLS LAST, ci."createdAt" ASC`,
      [from, to],
    );
    return rows.map(r => ({
      id: r.id, date: r.date, time: r.time || null, projectName: r.projectName || 'Проект',
      title: r.title || null, videographer: r.videographer || null,
      scriptItemId: r.scriptItemId, hasScript: !!r.hasScript, done: !!r.done,
    }));
  }

  /** Панель продюсера: съёмки недели — только посмотреть. */
  async shootsForPanel(from: string, to: string) {
    const isIso = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isIso(from) || !isIso(to) || from > to) throw new BadRequestException('Некорректный период');
    const items = await this.shoots(from, to).catch((e: any) => {
      this.logger.warn(`producer shoots failed: ${e?.message || e}`);
      return [] as ProducerShoot[];
    });
    return { from, to, items: items.map(({ scriptItemId: _s, ...rest }) => rest) };
  }

  /** Кому слать: все действующие продюсеры (основная или вторая роль). */
  private async producers(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM users WHERE "isActive" = true AND (role = 'producer' OR "secondaryRole" = 'producer')`,
    ).catch(() => []);
    return rows.map(r => r.id);
  }

  private async deliver(text: string, title: string, message: string) {
    const users = await this.producers();
    for (const userId of users) {
      await this.telegram.sendToUser(userId, text);
      try {
        await this.notifications.create({ userId, type: NotificationType.NEW_TASK, title, message, link: '/' });
      } catch (e) {
        this.logger.warn(`Уведомление продюсеру не создано ${userId}: ${(e as Error).message}`);
      }
    }
    return users.length;
  }

  /** 18:00 накануне: съёмки на завтра. */
  @Cron('0 18 * * *', { timeZone: TZ })
  async notifyTomorrow() {
    try {
      const day = addDays(dushanbeToday(), 1);
      const list = await this.shoots(day, day);
      const text = dailyMessage(day, list, this.telegram.appUrl, s => this.scriptUrl(s));
      if (!text) return;
      const n = list.filter(s => !s.done).length;
      const sent = await this.deliver(text, `Съёмки на завтра — ${n}`, ruLongDay(day));
      this.logger.log(`Продюсеру — съёмки на ${day}: ${n} (получателей ${sent})`);
    } catch (e: any) {
      this.logger.warn(`Съёмки на завтра не отправлены: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Суббота, 18:00: съёмки на следующую неделю. */
  @Cron('0 18 * * 6', { timeZone: TZ })
  async notifyNextWeek() {
    try {
      const { from, to } = nextWeek(dushanbeToday());
      const list = await this.shoots(from, to);
      const text = weeklyMessage(from, to, list, this.telegram.appUrl, s => this.scriptUrl(s));
      if (!text) return;
      const n = list.filter(s => !s.done).length;
      const sent = await this.deliver(text, `Съёмки на неделю — ${n}`, ruRange(from, addDays(to, -1)));
      this.logger.log(`Продюсеру — съёмки на неделю ${from}…${to}: ${n} (получателей ${sent})`);
    } catch (e: any) {
      this.logger.warn(`Съёмки на неделю не отправлены: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Страница сценария по ссылке — без входа. Ссылка живёт, пока рилс не
   *  вышел: опубликован, отменён или удалён — «ссылка больше не работает». */
  async publicScript(token: string) {
    const id = readScriptToken(token, this.secret);
    if (!id) throw new NotFoundException('Ссылка не найдена');
    const rows: any[] = await this.ds.query(
      `SELECT ci.id, ci.topic AS title, ci."scriptText" AS script, ci.status::text AS status,
              ci."prepStage" AS stage,
              to_char(ci."publishDate"::date, 'YYYY-MM-DD') AS "publishDate",
              ci."updatedAt" AS "updatedAt", p.name AS "projectName"
         FROM content_plan_items ci
         JOIN projects p ON p.id = ci."projectId"
        WHERE ci.id = $1`,
      [id],
    );
    const item = rows[0];
    if (!item || item.status === 'published' || item.status === 'cancelled') {
      throw new GoneException('Ссылка больше не работает');
    }
    // Сама ссылка ведёт на рилс; съёмку берём его — ближайшую не отменённую.
    // Ссылка на одиночную съёмку (без рилса) — она сама и есть съёмка.
    const shootRows: any[] = item.stage === 'shoot' ? [{ id: item.id }] : await this.ds.query(
      `SELECT s.id FROM content_plan_items s
        WHERE s."shootForItemId" = $1 AND s.status::text <> 'cancelled'
          AND COALESCE(s."prepStage", 'shoot') = 'shoot'
        ORDER BY s."publishDate" ASC NULLS LAST, s."createdAt" ASC LIMIT 1`,
      [id],
    );
    let shoot: { date: string | null; time: string | null; videographer: string | null } | null = null;
    if (shootRows[0]) {
      const sr: any[] = await this.ds.query(
        `SELECT to_char(s."publishDate"::date, 'YYYY-MM-DD') AS date, s."publishTime" AS time, u.name AS videographer
           FROM content_plan_items s LEFT JOIN users u ON u.id = s."assigneeId" WHERE s.id = $1`,
        [shootRows[0].id],
      );
      if (sr[0]) shoot = { date: sr[0].date || null, time: sr[0].time || null, videographer: sr[0].videographer || null };
    }
    return {
      title: item.title || null,
      projectName: item.projectName || null,
      shoot,
      publishDate: item.stage === 'shoot' ? null : item.publishDate || null,
      script: (item.script || '').trim() || null,
      updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
    };
  }
}
