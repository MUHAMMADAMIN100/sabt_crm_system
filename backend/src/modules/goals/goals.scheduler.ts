import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { escapeHtml } from '../../common/html-escape';
import { DEPT_KEYS, DEPT_NAME } from './departments';
import { monthName, shiftYm, todayDushanbe, weekStart, ymOf } from './goals.logic';
import { GoalsService } from './goals.service';
import type { DeptKey } from './goals.types';

const TZ = 'Asia/Dushanbe';
/** Сколько строк дайджеста отправлять — остальное на странице. */
const DIGEST_MAX_LINES = 8;

/**
 * Напоминания «Компаса компании» (16.11.2026, docs/GOALS_SPEC.md §8):
 *  - пн 10:00 — руководителям отделов с КР месяца: отметить статус недели;
 *  - вт 10:00 — основателям: дайджест, если есть что сказать;
 *  - 1-го в 10:00 — поставить цели нового месяца, если в прошлом они были.
 * Колокольчик (с дедупликацией) и Telegram со ссылкой на страницу.
 */
@Injectable()
export class GoalsScheduler {
  private readonly logger = new Logger(GoalsScheduler.name);

  constructor(
    private goals: GoalsService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  /** Колокольчик и Telegram. Telegram — только если уведомление создано. */
  private async notify(
    userId: string, type: NotificationType, title: string, message: string,
    link: string, alertKey: string, button: string,
  ): Promise<number> {
    try {
      const created = await this.notifications.createIfNotRecent({
        userId, type, title, message, link, data: { alertKey },
      }, 20);
      if (!created) return 0;
      const url = `${this.telegram.appUrl}${link}`;
      this.telegram.sendToUser(
        userId,
        `🧭 <b>${escapeHtml(title)}</b>\n${escapeHtml(message)}\n\n👉 <a href="${escapeHtml(url)}">${escapeHtml(button)}</a>`,
      ).catch(() => {});
      return 1;
    } catch (e: any) {
      this.logger.warn(`goal notify failed for ${userId}: ${String(e?.message || e).slice(0, 160)}`);
      return 0;
    }
  }

  @Cron('0 10 * * 1', { timeZone: TZ })
  async weeklyCheckin() {
    try {
      const n = await this.runWeeklyCheckin();
      if (n) this.logger.log(`goal checkin reminders: ${n}`);
    } catch (e: any) {
      this.logger.warn(`goal checkin reminders failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Понедельник: руководителям — отметить статус недели по своим отделам. */
  async runWeeklyCheckin(today: string = todayDushanbe()): Promise<number> {
    const { leaders, departments } = await this.goals.departmentsWithKeyResults(ymOf(today));
    const byLeader = new Map<string, DeptKey[]>();
    for (const d of departments) {
      const id = leaders[d]?.id;
      if (!id) continue;
      byLeader.set(id, [...(byLeader.get(id) || []), d]);
    }
    const week = weekStart(today);
    let sent = 0;
    for (const [userId, depts] of byLeader) {
      const names = depts.map(d => `«${DEPT_NAME[d]}»`).join(', ');
      const message = depts.length > 1
        ? `Отметьте статус недели по целям отделов ${names}`
        : `Отметьте статус недели по целям отдела ${names}`;
      sent += await this.notify(
        userId, NotificationType.GOAL_CHECKIN, 'Статус недели по целям', message,
        '/compass?checkin=1', `goal-checkin:${week}`, 'Отметить статус',
      );
    }
    return sent;
  }

  @Cron('0 10 * * 2', { timeZone: TZ })
  async weeklyDigest() {
    try {
      const n = await this.runDigest();
      if (n) this.logger.log(`goal digest: ${n}`);
    } catch (e: any) {
      this.logger.warn(`goal digest failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Вторник: основателям — КР в риске и отделы без отметки недели. */
  async runDigest(today: string = todayDushanbe()): Promise<number> {
    const d = await this.goals.digest(today);
    if (!d.lines.length) return 0;
    const shown = d.lines.slice(0, DIGEST_MAX_LINES);
    const more = d.lines.length - shown.length;
    const message = shown.map(l => `• ${l}`).join('\n') + (more > 0 ? `\n…и ещё ${more}` : '');
    let sent = 0;
    for (const userId of await this.goals.founderIds()) {
      sent += await this.notify(
        userId, NotificationType.GOAL_DIGEST, 'Цели компании: что требует внимания', message,
        '/compass', `goal-digest:${d.week}`, 'Открыть компас',
      );
    }
    return sent;
  }

  @Cron('0 10 1 * *', { timeZone: TZ })
  async monthStart() {
    try {
      const n = await this.runMonthStart();
      if (n) this.logger.log(`goal month reminders: ${n}`);
    } catch (e: any) {
      this.logger.warn(`goal month reminders failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** 1-е число: целей нового месяца нет, а в прошлом были — напомнить. */
  async runMonthStart(today: string = todayDushanbe()): Promise<number> {
    const ym = ymOf(today);
    const [now, prev, depts] = await Promise.all([
      this.goals.monthState(ym),
      this.goals.monthState(shiftYm(ym, -1)),
      this.goals.departmentsWithKeyResults(ym),
    ]);
    const month = monthName(ym);
    let sent = 0;
    if (now.objectives === 0 && prev.objectives > 0) {
      for (const userId of await this.goals.founderIds()) {
        sent += await this.notify(
          userId, NotificationType.GOAL_DIGEST, `Поставьте цели на ${month}`,
          'В прошлом месяце цели компании были — их можно перенести кнопкой «Перенести цели прошлого месяца».',
          '/compass', `goal-month:${ym}`, 'Открыть компас',
        );
      }
    }
    for (const key of DEPT_KEYS) {
      if (!prev.departments.has(key) || now.departments.has(key)) continue;
      const leaderId = depts.leaders[key]?.id;
      if (!leaderId) continue;
      sent += await this.notify(
        leaderId, NotificationType.GOAL_DIGEST, `Поставьте результаты отдела на ${month}`,
        `У отдела «${DEPT_NAME[key]}» пока нет результатов на ${month} — их можно перенести из прошлого месяца.`,
        '/compass', `goal-month:${ym}:${key}`, 'Открыть компас',
      );
    }
    return sent;
  }
}
