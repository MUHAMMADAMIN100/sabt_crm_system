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
 *  назначения на проект (продюсер в команде один, как видеограф). Видеограф
 *  получает те же сообщения, но только о своих съёмках — в утренней сводке
 *  9:00 их больше нет. Отдельный модуль по той же причине, что и сводка
 *  производству: Telegram в зависимостях ContentPlanModule замкнул бы
 *  кольцо модулей. */
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
              au.name AS videographer, ci."assigneeId" AS "assigneeId",
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
      title: r.title || null, videographer: r.videographer || null, assigneeId: r.assigneeId || null,
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
    return { from, to, items: items.map(({ scriptItemId: _s, assigneeId: _a, ...rest }) => rest) };
  }

  /** Кому слать: все действующие продюсеры (основная или вторая роль). */
  private async producers(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.ds.query(
      `SELECT id FROM users WHERE "isActive" = true AND (role = 'producer' OR "secondaryRole" = 'producer')`,
    ).catch(() => []);
    return rows.map(r => r.id);
  }

  private async deliver(users: string[], text: string, title: string, message: string) {
    for (const userId of users) {
      await this.telegram.sendToUser(userId, text);
      try {
        await this.notifications.create({ userId, type: NotificationType.NEW_TASK, title, message, link: '/' });
      } catch (e) {
        this.logger.warn(`Уведомление о съёмках не создано ${userId}: ${(e as Error).message}`);
      }
    }
  }

  /** Видеографам — каждому его съёмки: сообщение «Ваши съёмки…» строит build. */
  private async deliverOwn(
    list: ProducerShoot[], build: (own: ProducerShoot[]) => string | null, title: (n: number) => string, message: string,
  ) {
    const byUser = new Map<string, ProducerShoot[]>();
    for (const s of list) {
      if (!s.assigneeId || s.done) continue;
      byUser.set(s.assigneeId, [...(byUser.get(s.assigneeId) || []), s]);
    }
    for (const [userId, own] of byUser) {
      const text = build(own);
      if (text) await this.deliver([userId], text, title(own.length), message);
    }
    return byUser.size;
  }

  /** 18:00 накануне: съёмки на завтра — продюсеру все, видеографу свои. */
  @Cron('0 18 * * *', { timeZone: TZ })
  async notifyTomorrow() {
    try {
      const day = addDays(dushanbeToday(), 1);
      const list = await this.shoots(day, day);
      const link = (s: ProducerShoot) => this.scriptUrl(s);
      const text = dailyMessage(day, list, this.telegram.appUrl, link);
      if (!text) return;
      const n = list.filter(s => !s.done).length;
      const producers = await this.producers();
      await this.deliver(producers, text, `Съёмки на завтра — ${n}`, ruLongDay(day));
      const crew = await this.deliverOwn(list, own => dailyMessage(day, own, this.telegram.appUrl, link, { own: true }),
        k => `Ваши съёмки на завтра — ${k}`, ruLongDay(day));
      this.logger.log(`Съёмки на ${day}: ${n} (продюсеров ${producers.length}, видеографов ${crew})`);
    } catch (e: any) {
      this.logger.warn(`Съёмки на завтра не отправлены: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Суббота, 18:00: съёмки на следующую неделю — продюсеру все, видеографу свои. */
  @Cron('0 18 * * 6', { timeZone: TZ })
  async notifyNextWeek() {
    try {
      const { from, to } = nextWeek(dushanbeToday());
      const list = await this.shoots(from, to);
      const link = (s: ProducerShoot) => this.scriptUrl(s);
      const text = weeklyMessage(from, to, list, this.telegram.appUrl, link);
      if (!text) return;
      const n = list.filter(s => !s.done).length;
      const range = ruRange(from, addDays(to, -1));
      const producers = await this.producers();
      await this.deliver(producers, text, `Съёмки на неделю — ${n}`, range);
      const crew = await this.deliverOwn(list, own => weeklyMessage(from, to, own, this.telegram.appUrl, link, { own: true }),
        k => `Ваши съёмки на неделю — ${k}`, range);
      this.logger.log(`Съёмки на неделю ${from}…${to}: ${n} (продюсеров ${producers.length}, видеографов ${crew})`);
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
