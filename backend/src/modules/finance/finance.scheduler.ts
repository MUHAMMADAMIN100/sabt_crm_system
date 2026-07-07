import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { hasGrant } from '../auth/permissions';

const SMM_LINK = '/finance/income/smm';
/** За сколько дней до срока начинать напоминать. */
const REMIND_BEFORE_DAYS = 3;

/** Сегодняшняя дата по Душанбе — сервер (Railway) живёт в UTC. */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Разница в днях: date − today (положительное — впереди). */
function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

function formatRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function fmtMoney(n: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n) || 0)} с.`;
}

/** Напоминания об оплатах проектов: срок второй части (20 дней после первой)
 *  и новый платёж цикла в день контракта. Получатели — все пользователи с
 *  доступом к финансам (founder/co_founder или грант finance.manage):
 *  колокольчик + сокет (NotificationsService) и Telegram, если привязан. */
@Injectable()
export class FinanceScheduler {
  private readonly logger = new Logger(FinanceScheduler.name);

  constructor(
    @InjectRepository(FinancePlannedPayment) private ppRepo: Repository<FinancePlannedPayment>,
    @InjectRepository(FinanceProject) private projRepo: Repository<FinanceProject>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  /** Пользователи с доступом к разделу «Финансы». */
  private async financeUsers(): Promise<User[]> {
    const users = await this.userRepo.find({ where: { isActive: true, isBlocked: false } });
    return users.filter(u => hasGrant(u, 'finance.manage'));
  }

  /** Уведомить всех финансовых пользователей (дедуп по alertKey раз в сутки).
   *  Telegram шлём только когда уведомление реально создано — без спама. */
  async notifyFinanceUsers(opts: { title: string; message: string; alertKey: string; dedupHours?: number }): Promise<number> {
    const users = await this.financeUsers();
    let sent = 0;
    for (const u of users) {
      try {
        const created = await this.notifications.createIfNotRecent({
          userId: u.id, type: NotificationType.PAYMENT_REMINDER,
          title: opts.title, message: opts.message, link: SMM_LINK,
          data: { alertKey: opts.alertKey },
        }, opts.dedupHours ?? 20);
        if (created) {
          sent++;
          this.telegram.sendToUser(u.id, `💰 <b>${opts.title}</b>\n${opts.message}`).catch(() => {});
        }
      } catch (e: any) {
        this.logger.warn(`finance notify failed for ${u.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return sent;
  }

  /** Цикл проекта оплачен полностью → сообщаем о следующем платеже. */
  async notifyCycleCompleted(project: FinanceProject, next: FinancePlannedPayment) {
    const when = next.dueDate ? ` к ${formatRu(next.dueDate)}` : '';
    await this.notifyFinanceUsers({
      title: 'Цикл оплачен — запланирован новый платёж',
      message: `${project.name}: услуги за период оплачены полностью. Следующий платёж ${fmtMoney(Number(next.amount))}${when}.`,
      alertKey: `fin-cycle-next:${project.id}:${next.ym}`,
    });
  }

  /** Ежедневно в 9:00 Душанбе: ожидаемые оплаты, у которых срок ≤ 3 дней
   *  или уже просрочен, — напоминание раз в сутки до получения оплаты. */
  @Cron('0 9 * * *', { timeZone: 'Asia/Dushanbe' })
  async remindDuePayments() {
    try {
      const res = await this.runDueCheck();
      if (res.due > 0) this.logger.log(`finance reminders: due=${res.due}, notifications=${res.notified}`);
    } catch (e: any) {
      this.logger.warn(`finance reminders failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Проверка сроков (вызывается кроном и вручную из контроллера). */
  async runDueCheck(): Promise<{ due: number; notified: number }> {
    const today = todayISO();
    const horizon = addDays(today, REMIND_BEFORE_DAYS);
    const expected = await this.ppRepo.find({ where: { status: 'expected' } });
    const due = expected.filter(p => p.projectId && p.dueDate && p.dueDate <= horizon);
    if (!due.length) return { due: 0, notified: 0 };

    const projects = new Map((await this.projRepo.find()).map(p => [p.id, p]));
    let notified = 0;
    for (const pp of due) {
      const project = projects.get(pp.projectId as string);
      if (!project || project.archived) continue;
      const days = daysUntil(today, pp.dueDate as string);
      const what = pp.partNo === 2 ? 'вторая часть' : 'платёж';
      const when = days > 0
        ? `срок ${formatRu(pp.dueDate as string)} — через ${days} дн.`
        : days === 0
          ? `срок сегодня (${formatRu(pp.dueDate as string)})`
          : `просрочен на ${-days} дн. (срок был ${formatRu(pp.dueDate as string)})`;
      notified += await this.notifyFinanceUsers({
        title: days < 0 ? 'Оплата просрочена' : 'Приближается срок оплаты',
        message: `${project.name}: ${what} ${fmtMoney(Number(pp.amount))} — ${when}`,
        alertKey: `fin-pp-due:${pp.id}`,
      });
    }
    return { due: due.length, notified };
  }
}
