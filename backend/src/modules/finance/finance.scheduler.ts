import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceTransaction, FinanceTxType } from './finance-transaction.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { TelegramService } from '../telegram/telegram.service';
import { hasGrant } from '../auth/permissions';
import {
  isEarningFinanceProject,
  isPostedFinanceTransactionAsOf,
  remainingFinanceAmount,
  salaryForFinanceMonth,
  workedInFinanceMonth,
} from './finance-calculations';

const SMM_LINK = '/finance/income/smm';
const SUBS_LINK = '/finance/expense/rent_subs';
const SALARY_LINK = '/finance/expense/salary';
/** Страница направления дохода — для ссылки из напоминания об оплате. */
function directionLink(direction?: string | null): string {
  return ['smm', 'development', 'design', 'maintenance'].includes(direction || '') ? `/finance/income/${direction}` : SMM_LINK;
}
/** За сколько дней до срока начинать напоминать. */
const REMIND_BEFORE_DAYS = 3;
/** Числа месяца, по которым напоминаем о невыплаченной ЗП. */
const SALARY_REMIND_DAYS = [10, 15, 20, 25];

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

/** Напоминания об оплатах проектов: срок второй части (15 дней после первой)
 *  и новый платёж цикла в день контракта. Получатели — все пользователи с
 *  доступом к финансам (founder/co_founder или грант finance.manage):
 *  колокольчик + сокет (NotificationsService) и Telegram, если привязан. */
@Injectable()
export class FinanceScheduler {
  private readonly logger = new Logger(FinanceScheduler.name);

  constructor(
    @InjectRepository(FinancePlannedPayment) private ppRepo: Repository<FinancePlannedPayment>,
    @InjectRepository(FinanceProject) private projRepo: Repository<FinanceProject>,
    @InjectRepository(FinanceSubscription) private subRepo: Repository<FinanceSubscription>,
    @InjectRepository(FinanceEmployee) private empRepo: Repository<FinanceEmployee>,
    @InjectRepository(FinanceTransaction) private txRepo: Repository<FinanceTransaction>,
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
  async notifyFinanceUsers(opts: { title: string; message: string; alertKey: string; link?: string; dedupHours?: number }): Promise<number> {
    const users = await this.financeUsers();
    let sent = 0;
    for (const u of users) {
      try {
        const created = await this.notifications.createIfNotRecent({
          userId: u.id, type: NotificationType.PAYMENT_REMINDER,
          title: opts.title, message: opts.message, link: opts.link ?? SMM_LINK,
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
      link: directionLink(project.direction),
    });
  }

  /** Ежедневно в 9:00 Душанбе: оплаты проектов, регулярные платежи и ЗП. */
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
    let due = 0, notified = 0;

    const pp = await this.checkProjectPayments(today);
    const subs = await this.checkSubscriptionsDue(today);
    const salary = await this.checkSalaryDue(today);
    const paused = await this.checkPausedRevisions(today);
    due = pp.due + subs.due + salary.due + paused.due;
    notified = pp.notified + subs.notified + salary.notified + paused.notified;
    return { due, notified };
  }

  /** Ревизия пауз: каждые 14 дней с даты постановки напоминаем уточнить у
   *  клиента, продолжает ли он, — чтобы «заморозка» не стала забвением. */
  private async checkPausedRevisions(today: string): Promise<{ due: number; notified: number }> {
    const paused = (await this.projRepo.find()).filter(p => !p.archived && p.status === 'paused' && p.pausedAt);
    let due = 0, notified = 0;
    for (const p of paused) {
      const days = daysUntil(p.pausedAt as string, today); // прошло дней с паузы
      if (days <= 0 || days % 14 !== 0) continue;
      due++;
      const weeks = Math.round(days / 7);
      notified += await this.notifyFinanceUsers({
        title: 'Проект на паузе — пора уточнить',
        message: `${p.name}: на паузе уже ${weeks} нед. (с ${formatRu(p.pausedAt as string)}, тариф ${fmtMoney(Number(p.tariff))}/мес). Уточните у клиента, продолжаем ли работу.`,
        alertKey: `fin-paused:${p.id}:${days}`,
        link: directionLink(p.direction),
      });
    }
    return { due, notified };
  }

  /** Ожидаемые оплаты проектов со сроком ≤ 3 дней или просроченные. */
  private async checkProjectPayments(today: string): Promise<{ due: number; notified: number }> {
    const horizon = addDays(today, REMIND_BEFORE_DAYS);
    const expected = await this.ppRepo.find({ where: { status: 'expected' } });
    const due = expected.filter(p => p.projectId && p.dueDate && p.dueDate <= horizon);
    if (!due.length) return { due: 0, notified: 0 };

    const projects = new Map((await this.projRepo.find()).map(p => [p.id, p]));
    let eligibleDue = 0, notified = 0;
    for (const pp of due) {
      const project = projects.get(pp.projectId as string);
      // Пауза: платежи заморожены — не напоминаем, пока проект не вернут.
      if (!project || !isEarningFinanceProject(project)) continue;
      eligibleDue++;
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
        link: directionLink(project.direction),
      });
    }
    return { due: eligibleDue, notified };
  }

  /** Аренда/подписки с днём оплаты: не оплачено за месяц (ни операцией,
   *  ни отметкой) и срок ≤ 3 дней или прошёл. */
  private async checkSubscriptionsDue(today: string): Promise<{ due: number; notified: number }> {
    const ym = today.slice(0, 7);
    const subs = (await this.subRepo.find()).filter(s => s.active && s.dueDay);
    if (!subs.length) return { due: 0, notified: 0 };

    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthTx = await this.txRepo.find({
      where: { type: FinanceTxType.EXPENSE, date: Between(`${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`) } as any,
    });
    const paidBySubscription = new Map<string, number>();
    for (const tx of monthTx.filter(t =>
      t.subscriptionId && isPostedFinanceTransactionAsOf(t, today))) {
      paidBySubscription.set(
        tx.subscriptionId as string,
        (paidBySubscription.get(tx.subscriptionId as string) || 0) + Number(tx.amount),
      );
    }

    let due = 0, notified = 0;
    for (const s of subs) {
      if ((s.paidMarks || []).some(x => x.ym === ym)) continue;
      const remaining = remainingFinanceAmount(
        Number(s.amount),
        paidBySubscription.get(s.id) || 0,
      );
      if (remaining === 0) continue;
      const dueDate = `${ym}-${String(Math.min(s.dueDay as number, lastDay)).padStart(2, '0')}`;
      const days = daysUntil(today, dueDate);
      if (days > REMIND_BEFORE_DAYS) continue;
      due++;
      const kindLabel = s.kind === 'rent' ? 'Аренда' : 'Подписка';
      const when = days > 0 ? `срок ${formatRu(dueDate)} — через ${days} дн.`
        : days === 0 ? `срок сегодня (${formatRu(dueDate)})`
        : `просрочена на ${-days} дн. (срок был ${formatRu(dueDate)})`;
      notified += await this.notifyFinanceUsers({
        title: days < 0 ? `${kindLabel} не оплачена` : `Приближается срок: ${kindLabel.toLowerCase()}`,
        message: `${s.name}: осталось ${fmtMoney(remaining)} из ${fmtMoney(Number(s.amount))} — ${when}`,
        alertKey: `fin-sub-due:${s.id}:${ym}`,
        link: SUBS_LINK,
      });
    }
    return { due, notified };
  }

  /** Невыплаченная ЗП: напоминаем 10/15/20/25 числа, пока «к выплате» > 0.
   *  Выплаченным считаем месячные расходы с employeeId — ручные операции
   *  «Зарплата» без сотрудника сюда не попадают (допустимая погрешность). */
  private async checkSalaryDue(today: string): Promise<{ due: number; notified: number }> {
    const day = Number(today.slice(8, 10));
    if (!SALARY_REMIND_DAYS.includes(day)) return { due: 0, notified: 0 };
    const ym = today.slice(0, 7);
    const emps = (await this.empRepo.find()).filter(e => workedInFinanceMonth(e, ym));
    if (!emps.length) return { due: 0, notified: 0 };

    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const from = `${ym}-01`, to = `${ym}-${String(lastDay).padStart(2, '0')}`;
    // Выплаты месяца НАЧИСЛЕНИЯ (salaryYm, с fallback на дату), без отменённых.
    const monthTx = (await this.txRepo.createQueryBuilder('t')
      .where('t.type = :type', { type: FinanceTxType.EXPENSE })
      .andWhere('t."employeeId" IS NOT NULL')
      .andWhere(`COALESCE(t.status,'completed') = 'completed'`)
      .andWhere('t.date <= :asOf', { asOf: today })
      .andWhere('(t."salaryYm" = :ym OR (t."salaryYm" IS NULL AND t.date BETWEEN :from AND :to))', { ym, from, to })
      .getMany());
    // Остаток к выплате: по каждому сотруднику, закрытые (снапшот) месяцы —
    // пропускаем; аванс/бонус уже входят в выплаты, обязательство = оклад +
    // бонус − штраф (помесячные мапы — «за месяц начисления»).
    let toPay = 0;
    for (const e of emps) {
      if ((e.salarySnapshots || {})[ym]) continue;
      const empTx = monthTx.filter(t => t.employeeId === e.id);
      const paidE = empTx.reduce((s, t) => s + Number(t.amount), 0);
      // Бонус для обязательства берём из ОПЕРАЦИЙ (комментарий «Бонус»), как
      // зарплатная таблица: бонус уже входит в paidE, поэтому должен входить и
      // в due, иначе выданный бонус занижал бы «к выплате» (или гасил напоминание).
      const bonus = empTx
        .filter(t => (t.comment || '').trim().toLowerCase().startsWith('бонус'))
        .reduce((s, t) => s + Number(t.amount), 0);
      const fine = Number((e.fines || {})[ym]) || 0;
      const vacation = Number((e.vacations || {})[ym]) || 0;
      const due = Math.max(0, salaryForFinanceMonth(e, ym) + bonus - fine - vacation);
      toPay += Math.max(0, due - paidE);
    }
    toPay = Math.round(toPay * 100) / 100;
    if (toPay <= 0) return { due: 0, notified: 0 };

    const notified = await this.notifyFinanceUsers({
      title: 'Зарплата за месяц не выплачена полностью',
      message: `К выплате осталось ${fmtMoney(toPay)} (фонд + бонусы − авансы − выплачено). День выплаты — 10-е число.`,
      alertKey: `fin-salary:${ym}:${day}`,
      link: SALARY_LINK,
    });
    return { due: 1, notified };
  }
}
