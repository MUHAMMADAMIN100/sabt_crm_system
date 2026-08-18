import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { SmmDailyService, SmmDailyReport, DailyProjectRow, SMM_ROLE_LABELS } from './smm-daily.service';

function formatRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** «5 ч 20 м» / «45 м» из минут. */
function fmtDur(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h > 0) return m > 0 ? `${h} ч ${m} м` : `${h} ч`;
  return `${m} м`;
}

/** Ежевечерняя автоотправка основателю: что сделала СММ-команда за день.
 *  Дубли гасятся alertKey'ем по дате (перезапуск сервера не спамит). */
@Injectable()
export class SmmDailyScheduler {
  private readonly logger = new Logger(SmmDailyScheduler.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private smmDaily: SmmDailyService,
    private notifications: NotificationsService,
    private mail: MailService,
    private telegram: TelegramService,
  ) {}

  @Cron('0 20 * * *', { timeZone: 'Asia/Dushanbe' })
  async sendFounderDigest() {
    this.logger.log('SMM daily digest: compiling...');
    let report: SmmDailyReport;
    try {
      // Основателю — по ВСЕЙ компании: все сотрудники и все проекты.
      report = await this.smmDaily.getDaily(undefined, { allStaff: true });
    } catch (e: any) {
      this.logger.warn(`SMM daily digest failed to compile: ${e?.message || e}`);
      return;
    }

    const founders = await this.userRepo.find({
      where: { role: UserRole.FOUNDER, isActive: true, isBlocked: false },
    });
    if (founders.length === 0) {
      // Страховка: в проде может не оказаться аккаунта с ролью founder —
      // тогда отчёт молча уходил бы «в никуда». Логируем громко.
      this.logger.warn('SMM daily digest: no active user with role=founder — digest not delivered');
      return;
    }

    const { date, employees, totals, projects } = report;
    const overdueTotal = (projects || []).reduce((n, p) => n + p.overdue, 0);
    const summary =
      `Задач: ${totals.tasksDone} · этапов: ${totals.stagesDone} · историй: ${totals.storiesTotal}` +
      ` · активны ${totals.activeCount} из ${employees.length}` +
      (overdueTotal > 0 ? ` · просрочено ${overdueTotal}` : '');

    for (const f of founders) {
      const created = await this.notifications.createIfNotRecent({
        userId: f.id,
        type: NotificationType.NEW_REPORT,
        title: '📊 Ежедневный отчёт по компании',
        message: `За ${formatRu(date)}: ${summary}`,
        link: '/smm-daily',
        data: { alertKey: `smm-daily:${date}` },
      }, 20);
      if (!created) continue; // сегодня уже отправляли (рестарт/повторный крон)

      if (f.email) {
        try {
          await this.mail.sendGenericNotification(
            f.email, f.name, `Ежедневный отчёт по компании — ${formatRu(date)}`, this.emailHtml(report),
          );
        } catch (e: any) {
          this.logger.warn(`SMM daily digest: email to ${f.email} failed: ${e?.message || e}`);
        }
      }
      await this.telegram.sendToUser(f.id, this.telegramText(report)).catch(() => {});
    }
    this.logger.log(`SMM daily digest sent to ${founders.length} founder(s)`);
  }

  /** Таблица по сотрудникам для письма (бренд-обёртку даёт sendGenericNotification). */
  private emailHtml({ date, employees, totals, projects }: SmmDailyReport): string {
    const rows = employees.map(e => {
      const badge = (n: number, word: string) => (n > 0 ? `${n} ${word}` : '');
      const parts = [
        badge(e.stagesDone, 'этап.'), badge(e.storiesTotal, 'истор.'),
        badge(e.tasksDone, 'задач'), badge(e.returns, 'возвр.'),
        e.spentMinutes > 0 ? `⏱ ${fmtDur(e.spentMinutes)} на задачи` : '',
        e.hours > 0 ? `${e.hours} ч в системе` : '',
      ].filter(Boolean).join(' · ');
      const idle = !parts;
      const load = e.openTasks > 0
        ? `Нет активности · открыто задач ${e.openTasks}`
          + (e.overdueTasks > 0 ? `, просрочено ${e.overdueTasks}` : '')
        : 'Нет активности · задач не назначено';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">
          ${esc(e.name)}<br>
          <span style="font-weight:400;font-size:12px;color:#64748b;">${esc(SMM_ROLE_LABELS[e.role] || e.role)}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:${idle ? '#b45309' : '#334155'};font-size:13px;">
          ${idle ? esc(load) : esc(parts)}
        </td>
      </tr>`;
    }).join('');
    return `
      Активность СММ-команды за <b>${formatRu(date)}</b>.<br>
      Итого: этапов доски — <b>${totals.stagesDone}</b>, историй — <b>${totals.storiesTotal}</b>,
      задач — <b>${totals.tasksDone}</b>, активны <b>${totals.activeCount}</b> из ${employees.length}.
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">${rows}</table>
      ${this.projectsHtml(projects)}
      <p style="margin-top:16px;">Подробности по каждому — в CRM: раздел «Отчёты».</p>`;
  }

  /** Таблица движения по проектам — только в отчёте по всей компании. */
  private projectsHtml(projects?: DailyProjectRow[]): string {
    if (!projects || projects.length === 0) return '';
    const rows = projects.slice(0, 30).map(p => {
      const moved = [
        p.moved > 0 ? `${p.moved} этап.` : '',
        p.tasksDone > 0 ? `${p.tasksDone} задач` : '',
      ].filter(Boolean).join(' · ') || 'без движения';
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${esc(p.name)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;">${esc(moved)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:${p.overdue > 0 ? '#b91c1c' : '#64748b'};font-size:13px;">
          ${p.overdue > 0 ? `просрочено ${p.overdue}` : '—'}
        </td>
      </tr>`;
    }).join('');
    return `<h3 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">Проекты за день</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>`;
  }

  /** Текст для Telegram. Лимит сообщения 4096 символов, поэтому даём сводку,
   *  движение по проектам и отстающих, а полный список — в системе. */
  private telegramText({ date, employees, totals, projects }: SmmDailyReport): string {
    const weight = (e: any) => e.stagesDone + e.storiesTotal + e.tasksDone + e.returns;
    const active = employees.filter(e => weight(e) > 0);
    const idle = employees.filter(e => weight(e) === 0);
    const all = projects || [];
    const moving = all.filter(p => p.moved + p.tasksDone > 0);
    const overdueProjects = all.filter(p => p.overdue > 0);
    const overdueTotal = all.reduce((n, p) => n + p.overdue, 0);

    // Застой: неделю и дольше без движения (или движения не было вовсе).
    const weekAgo = Date.now() - 7 * 86_400_000;
    const stalled = all.filter(p => p.moved + p.tasksDone === 0
      && (!p.lastMoveAt || new Date(p.lastMoveAt).getTime() < weekAgo));

    const head = `📊 <b>Отчёт по компании за ${formatRu(date)}</b>\n`
      + `Задач закрыто: <b>${totals.tasksDone}</b> · этапов: <b>${totals.stagesDone}</b> · историй: <b>${totals.storiesTotal}</b>\n`
      + `Работали: <b>${active.length}</b> из ${employees.length}${overdueTotal > 0 ? ` · просрочено: <b>${overdueTotal}</b>` : ''}`;

    const section = (title: string, lines: string[], limit: number): string => {
      if (lines.length === 0) return '';
      const shown = lines.slice(0, limit);
      const rest = lines.length - shown.length;
      return `\n\n<b>${title}</b>\n` + shown.join('\n') + (rest > 0 ? `\n…и ещё ${rest}` : '');
    };

    const projectLines = moving.map(p => {
      const parts = [
        p.moved > 0 ? `этапов ${p.moved}` : '',
        p.tasksDone > 0 ? `задач ${p.tasksDone}` : '',
        p.overdue > 0 ? `просроч. ${p.overdue}` : '',
      ].filter(Boolean).join(', ');
      return `• ${esc(p.name)} — ${parts}`;
    });

    const peopleLines = active.map(e => {
      const parts = [
        e.tasksDone > 0 ? `задач ${e.tasksDone}` : '',
        e.stagesDone > 0 ? `этапов ${e.stagesDone}` : '',
        e.storiesTotal > 0 ? `историй ${e.storiesTotal}` : '',
        e.spentMinutes > 0 ? `⏱ ${fmtDur(e.spentMinutes)}` : '',
      ].filter(Boolean).join(', ');
      return `• ${esc(e.name.trim())} — ${parts}`;
    });

    const laggingLines: string[] = [];
    // Молчал, но задачи на нём висят — вот это стоит внимания. Тех, кому
    // просто ничего не назначено, показываем одной цифрой, иначе раздел
    // превращается в перечисление половины компании.
    const stuck = idle.filter(e => e.openTasks > 0)
      .sort((a, b) => (b.overdueTasks - a.overdueTasks) || (b.openTasks - a.openTasks));
    for (const e of stuck.slice(0, 6)) {
      laggingLines.push(`😴 ${esc(e.name.trim())} — не двигал задачи, открыто ${e.openTasks}`
        + (e.overdueTasks > 0 ? `, просрочено ${e.overdueTasks}` : ''));
    }
    if (stuck.length > 6) laggingLines.push(`😴 …и ещё ${stuck.length - 6} без движения по своим задачам`);
    const freeIdle = idle.length - stuck.length;
    if (freeIdle > 0) laggingLines.push(`⚪ Без задач и активности: ${freeIdle}`);
    for (const p of overdueProjects.slice(0, 5)) {
      laggingLines.push(`⚠️ ${esc(p.name)} — просрочено ${p.overdue}`);
    }
    if (overdueProjects.length > 5) laggingLines.push(`⚠️ …и ещё ${overdueProjects.length - 5} проектов с просрочкой`);
    for (const p of stalled.slice(0, 5)) {
      laggingLines.push(`🕸 ${esc(p.name)} — нет движения неделю и дольше`);
    }
    if (stalled.length > 5) laggingLines.push(`🕸 …и ещё ${stalled.length - 5} проектов без движения`);

    let text = head
      + section('Проекты в работе', projectLines, 12)
      + section('Сотрудники', peopleLines, 15)
      + section('Требует внимания', laggingLines, 20)
      + `\n\n👉 ${this.telegram.appUrl}/smm-daily`;

    // Страховка от лимита Telegram: режем по последнему переносу строки.
    const LIMIT = 3900;
    if (text.length > LIMIT) {
      const cut = text.lastIndexOf('\n', LIMIT);
      text = text.slice(0, cut > 0 ? cut : LIMIT) + `\n\n…полный отчёт: ${this.telegram.appUrl}/smm-daily`;
    }
    return text;
  }
}
