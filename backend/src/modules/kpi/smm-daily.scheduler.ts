import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { SmmDailyService, SmmDailyReport, SMM_ROLE_LABELS } from './smm-daily.service';

function formatRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
      report = await this.smmDaily.getDaily();
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

    const { date, employees, totals } = report;
    const summary =
      `Этапов доски: ${totals.stagesDone} · историй: ${totals.storiesTotal} · задач: ${totals.tasksDone}` +
      ` · активны ${totals.activeCount} из ${employees.length}`;

    for (const f of founders) {
      const created = await this.notifications.createIfNotRecent({
        userId: f.id,
        type: NotificationType.NEW_REPORT,
        title: '📊 Ежедневный отчёт СММ',
        message: `За ${formatRu(date)}: ${summary}`,
        link: '/smm-daily',
        data: { alertKey: `smm-daily:${date}` },
      }, 20);
      if (!created) continue; // сегодня уже отправляли (рестарт/повторный крон)

      if (f.email) {
        try {
          await this.mail.sendGenericNotification(
            f.email, f.name, `Ежедневный отчёт СММ — ${formatRu(date)}`, this.emailHtml(report),
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
  private emailHtml({ date, employees, totals }: SmmDailyReport): string {
    const rows = employees.map(e => {
      const badge = (n: number, word: string) => (n > 0 ? `${n} ${word}` : '');
      const parts = [
        badge(e.stagesDone, 'этап.'), badge(e.storiesTotal, 'истор.'),
        badge(e.tasksDone, 'задач'), badge(e.returns, 'возвр.'),
        e.hours > 0 ? `${e.hours} ч` : '',
      ].filter(Boolean).join(' · ');
      const idle = !parts;
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">
          ${esc(e.name)}<br>
          <span style="font-weight:400;font-size:12px;color:#64748b;">${esc(SMM_ROLE_LABELS[e.role] || e.role)}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:${idle ? '#b45309' : '#334155'};font-size:13px;">
          ${idle ? 'Нет активности' : esc(parts)}
        </td>
      </tr>`;
    }).join('');
    return `
      Активность СММ-команды за <b>${formatRu(date)}</b>.<br>
      Итого: этапов доски — <b>${totals.stagesDone}</b>, историй — <b>${totals.storiesTotal}</b>,
      задач — <b>${totals.tasksDone}</b>, активны <b>${totals.activeCount}</b> из ${employees.length}.
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">${rows}</table>
      <p style="margin-top:16px;">Подробности по каждому — в CRM: раздел «Отчёты СММ».</p>`;
  }

  private telegramText({ date, employees, totals }: SmmDailyReport): string {
    const lines = employees.map(e => {
      const parts = [
        e.stagesDone > 0 ? `этапов ${e.stagesDone}` : '',
        e.storiesTotal > 0 ? `историй ${e.storiesTotal}` : '',
        e.tasksDone > 0 ? `задач ${e.tasksDone}` : '',
      ].filter(Boolean).join(', ');
      return `• <b>${esc(e.name)}</b>: ${parts || 'нет активности'}`;
    });
    return `📊 <b>Отчёт СММ за ${formatRu(date)}</b>\n` +
      `Этапов: ${totals.stagesDone} · историй: ${totals.storiesTotal} · задач: ${totals.tasksDone}\n\n` +
      lines.join('\n');
  }
}
