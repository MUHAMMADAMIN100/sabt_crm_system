import { Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import {
  FinanceTransaction, FinanceTxType, FinanceAccount,
  FinanceCategory, FinanceTxStatus,
} from './finance-transaction.entity';
import { FinanceSubscription } from './finance-subscription.entity';
import { FinanceDebt } from './finance-debt.entity';
import { FinancePlannedPayment } from './finance-planned-payment.entity';
import { FinanceSetting } from './finance-setting.entity';
import { Project } from '../projects/project.entity';

const ACCOUNTS: FinanceAccount[] = [FinanceAccount.ALIF, FinanceAccount.DUSHANBE_CITY, FinanceAccount.CASH];
/** Направление проекта → группа доходов финмодуля. */
function directionOf(projectType?: string | null): 'smm' | 'development' | 'design' {
  if (projectType === 'SMM') return 'smm';
  if (/дизайн|design/i.test(projectType || '')) return 'design';
  return 'development';
}
const incomeCategoryOf = (group: string) =>
  group === 'development' ? 'development' : group === 'design' ? 'design' : 'project';

export interface FinanceFilters {
  account?: FinanceAccount;
  type?: FinanceTxType;
  category?: string;
  status?: FinanceTxStatus;
  search?: string;
  from?: string;
  to?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class FinanceService implements OnModuleInit {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(FinanceTransaction) private repo: Repository<FinanceTransaction>,
    @InjectRepository(FinanceSubscription) private subRepo: Repository<FinanceSubscription>,
    @InjectRepository(FinanceDebt) private debtRepo: Repository<FinanceDebt>,
    @InjectRepository(FinancePlannedPayment) private planRepo: Repository<FinancePlannedPayment>,
    @InjectRepository(FinanceSetting) private settingRepo: Repository<FinanceSetting>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  /** Рантайм-DDL: новые колонки транзакций + новые таблицы (на проде
   *  synchronize выключен, миграции ведём idempotent-скриптами). */
  async onModuleInit() {
    const q = (sql: string) => this.repo.manager.query(sql).catch((e: any) =>
      this.logger.warn(`finance DDL failed: ${e?.message || e}`));
    for (const col of [
      `ADD COLUMN IF NOT EXISTS "group" varchar(20)`,
      `ADD COLUMN IF NOT EXISTS "projectId" uuid`,
      `ADD COLUMN IF NOT EXISTS "subscriptionId" uuid`,
      `ADD COLUMN IF NOT EXISTS "debtId" uuid`,
      `ADD COLUMN IF NOT EXISTS "plannedPaymentId" uuid`,
    ]) await q(`ALTER TABLE finance_transactions ${col}`);
    await q(`CREATE TABLE IF NOT EXISTS finance_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL,
      amount numeric(15,2) NOT NULL DEFAULT 0, kind varchar(20) NOT NULL DEFAULT 'subscription',
      "accountId" varchar(30), active boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS finance_debts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL, counterparty varchar,
      "totalAmount" numeric(15,2) NOT NULL DEFAULT 0, "paidBefore" numeric(15,2) NOT NULL DEFAULT 0,
      "monthlyPayment" numeric(15,2), "accountId" varchar(30), "startDate" date, note text,
      "createdAt" timestamp NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS finance_planned_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid, "debtId" uuid,
      ym varchar(7) NOT NULL, "partNo" int NOT NULL DEFAULT 1, amount numeric(15,2) NOT NULL DEFAULT 0,
      status varchar(20) NOT NULL DEFAULT 'expected', "receivedTxId" uuid, auto boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS finance_settings (key varchar(64) PRIMARY KEY, value jsonb)`);
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  async findAll(f: FinanceFilters = {}) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.createdBy', 'createdBy');

    if (f.account)  qb.andWhere('t.account = :acc',  { acc: f.account });
    if (f.type)     qb.andWhere('t.type = :tp',      { tp: f.type });
    if (f.category) qb.andWhere('t.category = :cat', { cat: f.category });
    if (f.status)   qb.andWhere('t.status = :st',    { st: f.status });
    if (f.from)     qb.andWhere('t.date >= :from',   { from: f.from });
    if (f.to)       qb.andWhere('t.date <= :to',     { to: f.to });
    if (f.search) {
      qb.andWhere(
        '(t.description ILIKE :s OR t.counterparty ILIKE :s OR t.project ILIKE :s OR t.comment ILIKE :s)',
        { s: `%${f.search}%` },
      );
    }

    switch (f.sort) {
      case 'date_asc':    qb.orderBy('t.date', 'ASC').addOrderBy('t.createdAt', 'ASC'); break;
      case 'amount_desc': qb.orderBy('t.amount', 'DESC'); break;
      case 'amount_asc':  qb.orderBy('t.amount', 'ASC'); break;
      default:            qb.orderBy('t.date', 'DESC').addOrderBy('t.createdAt', 'DESC');
    }

    const page = Math.max(1, f.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 15));
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['createdBy'] });
    if (!t) throw new NotFoundException('Transaction not found');
    return t;
  }

  async create(dto: Partial<FinanceTransaction>, createdById?: string) {
    if (dto.amount == null || Number(dto.amount) <= 0) {
      throw new BadRequestException('Сумма должна быть больше нуля');
    }
    if (!dto.description || !dto.description.trim()) {
      throw new BadRequestException('Описание обязательно');
    }
    const splits = this.normalizeSplits(dto.splits, Number(dto.amount));
    const t = this.repo.create({
      ...dto,
      // Если сплит задан — `account` ставим в счёт первой части (для обратной
      // совместимости со старыми отчётами, которые не читают splits).
      account: splits ? splits[0].account : dto.account,
      splits,
      createdById: dto.createdById ?? createdById,
      status: dto.status ?? FinanceTxStatus.COMPLETED,
    });
    return this.repo.save(t);
  }

  async update(id: string, dto: Partial<FinanceTransaction>) {
    await this.findOne(id);
    if (dto.amount != null && Number(dto.amount) <= 0) {
      throw new BadRequestException('Сумма должна быть больше нуля');
    }
    if (dto.description != null && !dto.description.trim()) {
      throw new BadRequestException('Описание не может быть пустым');
    }
    const { id: _id, createdAt, updatedAt, createdById, ...patch } = dto as any;
    if (patch.splits !== undefined) {
      const amount = patch.amount != null ? Number(patch.amount) : Number((await this.findOne(id)).amount);
      patch.splits = this.normalizeSplits(patch.splits, amount);
      if (patch.splits) patch.account = patch.splits[0].account;
    }
    await this.repo.update(id, patch);
    return this.findOne(id);
  }

  /** Проверяем, что splits корректны и сумма частей == полной сумме.
   *  Возвращаем нормализованный массив (или null если splits пуст/не задан). */
  private normalizeSplits(
    raw: any,
    totalAmount: number,
  ): Array<{ account: FinanceAccount; amount: number }> | null {
    if (raw == null) return null;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // Один счёт в сплите — это не сплит, схлопываем.
    if (raw.length === 1) return null;

    const validAccounts = Object.values(FinanceAccount) as string[];
    const items = raw.map((r: any, idx: number) => {
      const amount = Number(r?.amount);
      const account = r?.account;
      if (!validAccounts.includes(account)) {
        throw new BadRequestException(`splits[${idx}]: неизвестный счёт «${account}»`);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(`splits[${idx}]: сумма должна быть больше нуля`);
      }
      return { account: account as FinanceAccount, amount: Math.round(amount * 100) / 100 };
    });

    const sum = items.reduce((s, it) => s + it.amount, 0);
    // Допускаем погрешность копеек после округления.
    if (Math.abs(sum - totalAmount) > 0.01) {
      throw new BadRequestException(
        `Сумма сплита (${sum.toFixed(2)}) не равна общей сумме (${totalAmount.toFixed(2)})`,
      );
    }
    return items;
  }

  async remove(id: string) {
    const t = await this.findOne(id);
    await this.repo.remove(t);
    return { message: 'Transaction deleted' };
  }

  // ─── AGGREGATORS ─────────────────────────────────────────────────

  /** Сводка по каждому из трёх счетов: баланс, доход, расход, кол-во.
   *  Транзакции со статусом cancelled не учитываются.
   *
   *  Сплит-оплаты разносятся по счетам в соответствии с частями: одна
   *  транзакция 1000 → 600 Alif + 400 DC даст +600 балансу Alif и +400 DC.
   *  Для счётчика count сплит считается как 1 транзакция на основной счёт
   *  (account), чтобы количество не задваивалось. */
  async getAccountsSummary() {
    const accounts: FinanceAccount[] = [
      FinanceAccount.ALIF, FinanceAccount.DUSHANBE_CITY, FinanceAccount.CASH,
    ];

    // Тащим все нужные поля и считаем агрегаты в памяти — простое и
    // надёжное, объёмов транзакций для агентства это вполне выдерживает.
    const txs = await this.repo.find({
      where: {},
      select: ['id', 'type', 'amount', 'account', 'splits', 'status'] as any,
    });

    const init = () => ({ income: 0, expense: 0, count: 0 });
    const map: Record<string, { income: number; expense: number; count: number }> = {};
    for (const acc of accounts) map[acc] = init();

    for (const t of txs) {
      if (t.status === FinanceTxStatus.CANCELLED) continue;
      const total = Number(t.amount) || 0;
      const isIncome = t.type === FinanceTxType.INCOME;
      // count — по «основному» счёту, чтобы не дублировать одну транзакцию.
      if (map[t.account]) map[t.account].count += 1;

      const parts = Array.isArray(t.splits) && t.splits.length > 0
        ? t.splits
        : [{ account: t.account, amount: total }];
      for (const p of parts) {
        const bucket = map[p.account];
        if (!bucket) continue;
        const amt = Number(p.amount) || 0;
        if (isIncome) bucket.income += amt;
        else          bucket.expense += amt;
      }
    }

    const opening = await this.getOpeningBalances();
    const summary = accounts.map(acc => ({
      account: acc,
      opening: Number(opening[acc]) || 0,
      // Баланс = стартовый + приход − расход (сквозной, не за месяц).
      balance: (Number(opening[acc]) || 0) + map[acc].income - map[acc].expense,
      income:  map[acc].income,
      expense: map[acc].expense,
      count:   map[acc].count,
    }));

    const allOpening = summary.reduce((s, a) => s + a.opening, 0);
    const allIncome  = summary.reduce((s, a) => s + a.income, 0);
    const allExpense = summary.reduce((s, a) => s + a.expense, 0);
    const allCount   = summary.reduce((s, a) => s + a.count, 0);

    return {
      perAccount: summary,
      total: {
        opening: allOpening,
        balance: allOpening + allIncome - allExpense,
        income: allIncome,
        expense: allExpense,
        count: allCount,
      },
    };
  }

  // ─── Стартовые балансы счетов ─────────────────────────────────────
  async getOpeningBalances(): Promise<Record<string, number>> {
    const row = await this.settingRepo.findOne({ where: { key: 'openingBalances' } }).catch(() => null);
    const v = (row?.value || {}) as Record<string, number>;
    return { alif: Number(v.alif) || 0, dushanbe_city: Number(v.dushanbe_city) || 0, cash: Number(v.cash) || 0 };
  }

  async setOpeningBalances(dto: Record<string, any>): Promise<Record<string, number>> {
    const cur = await this.getOpeningBalances();
    const next = {
      alif: dto.alif != null ? Number(dto.alif) || 0 : cur.alif,
      dushanbe_city: dto.dushanbe_city != null ? Number(dto.dushanbe_city) || 0 : cur.dushanbe_city,
      cash: dto.cash != null ? Number(dto.cash) || 0 : cur.cash,
    };
    await this.settingRepo.save({ key: 'openingBalances', value: next });
    return next;
  }

  /** 6 месяцев истории включая текущий: доход и расход по месяцам.
   *  Опционально фильтр по счёту. */
  async getMonthly(account?: FinanceAccount, months = 6) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const fromStr = from.toISOString().split('T')[0];

    const qb = this.repo.createQueryBuilder('t')
      .select(`TO_CHAR(t.date, 'YYYY-MM')`, 'month')
      .addSelect('t.type', 'type')
      .addSelect('SUM(t.amount)', 'total')
      .where(`t.status != 'cancelled'`)
      .andWhere('t.date >= :from', { from: fromStr });
    if (account) qb.andWhere('t.account = :acc', { acc: account });
    qb.groupBy('month').addGroupBy('t.type').orderBy('month', 'ASC');

    const rows: Array<{ month: string; type: string; total: string }> = await qb.getRawMany();

    // Заполняем все 6 месяцев — даже если в каком-то 0 транзакций
    const result: Array<{ month: string; income: number; expense: number }> = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
      const monthKey = d.toISOString().slice(0, 7); // YYYY-MM
      const income  = Number(rows.find(r => r.month === monthKey && r.type === 'income')?.total  || 0);
      const expense = Number(rows.find(r => r.month === monthKey && r.type === 'expense')?.total || 0);
      result.push({ month: monthKey, income, expense });
    }
    return result;
  }

  /** Расходы по категориям — для donut chart.
   *  Опционально фильтр по счёту и периоду. */
  async getByCategory(account?: FinanceAccount, from?: string, to?: string) {
    const qb = this.repo.createQueryBuilder('t')
      .select('t.category', 'category')
      .addSelect('SUM(t.amount)', 'total')
      .addSelect('COUNT(*)', 'cnt')
      .where(`t.status != 'cancelled'`)
      .andWhere(`t.type = 'expense'`);
    if (account) qb.andWhere('t.account = :acc', { acc: account });
    if (from)    qb.andWhere('t.date >= :from', { from });
    if (to)      qb.andWhere('t.date <= :to', { to });
    qb.groupBy('t.category').orderBy('total', 'DESC');

    const rows: Array<{ category: string; total: string; cnt: string }> = await qb.getRawMany();
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    return rows.map(r => ({
      category: r.category,
      total: Number(r.total),
      count: Number(r.cnt),
      percent: total > 0 ? Math.round((Number(r.total) / total) * 100) : 0,
    }));
  }

  /** Список доступных категорий: стандартные + все, что когда-либо
   *  встречались в транзакциях (т.е. добавленные пользователем). Так
   *  пользовательские категории «сохраняются» и переиспользуются. */
  async getCategories(): Promise<string[]> {
    const rows: Array<{ category: string }> = await this.repo
      .createQueryBuilder('t')
      .select('DISTINCT t.category', 'category')
      .where('t.category IS NOT NULL')
      .getRawMany();
    const used = rows.map(r => r.category).filter(Boolean);
    const defaults = Object.values(FinanceCategory) as string[];
    return Array.from(new Set([...defaults, ...used]));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ПОДПИСКИ / АРЕНДА
  // ═══════════════════════════════════════════════════════════════════
  listSubscriptions() { return this.subRepo.find({ order: { active: 'DESC', name: 'ASC' } }); }

  createSubscription(dto: any) {
    if (!dto?.name?.trim()) throw new BadRequestException('Название обязательно');
    return this.subRepo.save(this.subRepo.create({
      name: dto.name.trim(), amount: Number(dto.amount) || 0,
      kind: dto.kind === 'rent' ? 'rent' : 'subscription',
      accountId: dto.accountId || null, active: dto.active !== false,
    }));
  }
  async updateSubscription(id: string, dto: any) {
    await this.subRepo.update(id, {
      ...(dto.name != null ? { name: String(dto.name).trim() } : {}),
      ...(dto.amount != null ? { amount: Number(dto.amount) || 0 } : {}),
      ...(dto.kind != null ? { kind: dto.kind === 'rent' ? 'rent' : 'subscription' } : {}),
      ...(dto.accountId !== undefined ? { accountId: dto.accountId || null } : {}),
      ...(dto.active != null ? { active: !!dto.active } : {}),
    });
    return this.subRepo.findOne({ where: { id } });
  }
  async deleteSubscription(id: string) { await this.subRepo.delete(id); return { ok: true }; }

  /** Подписки со статусом оплаты за месяц. */
  async subscriptionsForMonth(ym: string) {
    const subs = await this.subRepo.find({ order: { active: 'DESC', name: 'ASC' } });
    const { from, to } = this.monthRange(ym);
    const txs = await this.repo.find({ where: { date: Between(from, to) } });
    return subs.map(s => {
      const paidTxs = txs.filter(t => t.subscriptionId === s.id && t.status !== FinanceTxStatus.CANCELLED);
      const paidAmount = paidTxs.reduce((acc, t) => acc + Number(t.amount || 0), 0);
      const lastDate = paidTxs.map(t => t.date).sort().pop() || null;
      const amount = Number(s.amount) || 0;
      return { ...s, amount, paidAmount, paid: amount > 0 && paidAmount >= amount, lastDate };
    });
  }

  async paySubscription(id: string, ym: string, account?: string, date?: string) {
    const s = await this.subRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Подписка не найдена');
    return this.create({
      type: FinanceTxType.EXPENSE, amount: Number(s.amount) || 0,
      date: date || `${ym}-01`, account: (account as FinanceAccount) || (s.accountId as FinanceAccount) || FinanceAccount.ALIF,
      category: s.kind === 'rent' ? 'rent' : 'subscription', group: 'rent_subs' as any,
      description: s.name, subscriptionId: s.id as any, status: FinanceTxStatus.COMPLETED,
    } as any);
  }

  async cancelSubscriptionMonth(id: string, ym: string) {
    const { from, to } = this.monthRange(ym);
    const txs = await this.repo.find({ where: { subscriptionId: id, date: Between(from, to) } });
    if (txs.length) await this.repo.remove(txs);
    return { ok: true, removed: txs.length };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ДОЛГИ
  // ═══════════════════════════════════════════════════════════════════
  private async debtPaidMap(): Promise<Record<string, number>> {
    const txs = await this.repo.find({ where: {}, select: ['debtId', 'amount', 'status'] as any });
    const map: Record<string, number> = {};
    for (const t of txs) {
      if (!t.debtId || t.status === FinanceTxStatus.CANCELLED) continue;
      map[t.debtId] = (map[t.debtId] || 0) + Number(t.amount || 0);
    }
    return map;
  }
  private debtRemaining(d: FinanceDebt, paid: number): number {
    return Math.max(0, (Number(d.totalAmount) || 0) - (Number(d.paidBefore) || 0) - (paid || 0));
  }

  async listDebts() {
    const [debts, paidMap] = await Promise.all([this.debtRepo.find({ order: { name: 'ASC' } }), this.debtPaidMap()]);
    return debts.map(d => ({
      ...d, totalAmount: Number(d.totalAmount) || 0, paidBefore: Number(d.paidBefore) || 0,
      monthlyPayment: d.monthlyPayment == null ? null : Number(d.monthlyPayment),
      remaining: this.debtRemaining(d, paidMap[d.id] || 0),
    }));
  }

  async createDebt(dto: any) {
    if (!dto?.name?.trim()) throw new BadRequestException('Название обязательно');
    const d = await this.debtRepo.save(this.debtRepo.create({
      name: dto.name.trim(), counterparty: dto.counterparty || null,
      totalAmount: Number(dto.totalAmount) || 0, paidBefore: Number(dto.paidBefore) || 0,
      monthlyPayment: dto.monthlyPayment != null ? Number(dto.monthlyPayment) || 0 : null,
      accountId: dto.accountId || null, startDate: dto.startDate || null, note: dto.note || null,
    }));
    await this.regenerateDebtSchedule(d.id);
    return d;
  }
  async updateDebt(id: string, dto: any) {
    await this.debtRepo.update(id, {
      ...(dto.name != null ? { name: String(dto.name).trim() } : {}),
      ...(dto.counterparty !== undefined ? { counterparty: dto.counterparty || null } : {}),
      ...(dto.totalAmount != null ? { totalAmount: Number(dto.totalAmount) || 0 } : {}),
      ...(dto.paidBefore != null ? { paidBefore: Number(dto.paidBefore) || 0 } : {}),
      ...(dto.monthlyPayment !== undefined ? { monthlyPayment: dto.monthlyPayment != null ? Number(dto.monthlyPayment) || 0 : null } : {}),
      ...(dto.accountId !== undefined ? { accountId: dto.accountId || null } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate || null } : {}),
      ...(dto.note !== undefined ? { note: dto.note || null } : {}),
    });
    await this.regenerateDebtSchedule(id);
    return this.debtRepo.findOne({ where: { id } });
  }
  async deleteDebt(id: string) {
    await this.planRepo.delete({ debtId: id });
    const txs = await this.repo.find({ where: { debtId: id } });
    if (txs.length) await this.repo.remove(txs);
    await this.debtRepo.delete(id);
    return { ok: true };
  }

  /** Авто-раскидывание остатка долга по monthlyPayment (received не трогаем). */
  async regenerateDebtSchedule(debtId: string) {
    const d = await this.debtRepo.findOne({ where: { id: debtId } });
    if (!d) return { ok: false };
    const monthly = Number(d.monthlyPayment) || 0;
    const plans = await this.planRepo.find({ where: { debtId } });
    const expected = plans.filter(p => p.status === 'expected');
    if (expected.length) await this.planRepo.remove(expected);
    if (monthly <= 0) return { ok: true };
    const receivedPlans = plans.filter(p => p.status === 'received');
    const receivedSum = receivedPlans.reduce((s, p) => s + Number(p.amount || 0), 0);
    const receivedYms = new Set(receivedPlans.map(p => p.ym));
    let remaining = Math.max(0, (Number(d.totalAmount) || 0) - (Number(d.paidBefore) || 0) - receivedSum);
    let ym = this.currentYm();
    const toAdd: Partial<FinancePlannedPayment>[] = [];
    let guard = 0;
    while (remaining > 0 && guard < 240) {
      guard++;
      if (!receivedYms.has(ym)) {
        const amt = Math.min(monthly, remaining);
        toAdd.push({ debtId, ym, partNo: 1, amount: amt, status: 'expected' });
        remaining -= amt;
      }
      ym = this.shiftYm(ym, 1);
    }
    if (toAdd.length) await this.planRepo.save(toAdd.map(p => this.planRepo.create(p)));
    return { ok: true, added: toAdd.length };
  }

  async debtsMatrix(start?: string, months = 6) {
    const [debts, paidMap] = await Promise.all([this.debtRepo.find({ order: { name: 'ASC' } }), this.debtPaidMap()]);
    const ids = debts.map(d => d.id);
    const planned = ids.length ? await this.planRepo.find({ where: { debtId: In(ids) } }) : [];
    const monthsArr = this.monthWindow(start, months, planned.map(p => p.ym).concat(debts.map(d => (d.startDate || '').slice(0, 7)).filter(Boolean)));
    const rows = debts.map(d => {
      const byMonth: Record<string, any[]> = {};
      for (const ym of monthsArr) byMonth[ym] = planned.filter(p => p.debtId === d.id && p.ym === ym).map(this.planDto);
      return {
        id: d.id, name: d.name, total: Number(d.totalAmount) || 0,
        remaining: this.debtRemaining(d, paidMap[d.id] || 0), byMonth,
      };
    });
    return { months: monthsArr, rows };
  }

  async addDebtPlan(debtId: string, ym: string, amount: number) {
    return this.planRepo.save(this.planRepo.create({ debtId, ym, partNo: 1, amount: Number(amount) || 0, status: 'expected' }));
  }
  async payDebtPlanned(plannedId: string, account?: string, date?: string) {
    const p = await this.planRepo.findOne({ where: { id: plannedId } });
    if (!p || !p.debtId) throw new NotFoundException('План не найден');
    const d = await this.debtRepo.findOne({ where: { id: p.debtId } });
    const tx = await this.create({
      type: FinanceTxType.EXPENSE, amount: Number(p.amount) || 0, date: date || `${p.ym}-01`,
      account: (account as FinanceAccount) || FinanceAccount.ALIF, category: 'debt', group: 'debts' as any,
      debtId: p.debtId as any, description: `Погашение: ${d?.name || ''}`.trim(), status: FinanceTxStatus.COMPLETED,
    } as any);
    await this.planRepo.update(plannedId, { status: 'received', receivedTxId: (tx as any).id });
    return { ok: true };
  }
  async addPaidDebt(debtId: string, ym: string, amount: number, account?: string, date?: string) {
    const d = await this.debtRepo.findOne({ where: { id: debtId } });
    const tx = await this.create({
      type: FinanceTxType.EXPENSE, amount: Number(amount) || 0, date: date || `${ym}-01`,
      account: (account as FinanceAccount) || FinanceAccount.ALIF, category: 'debt', group: 'debts' as any,
      debtId: debtId as any, description: `Погашение: ${d?.name || ''}`.trim(), status: FinanceTxStatus.COMPLETED,
    } as any);
    await this.planRepo.save(this.planRepo.create({ debtId, ym, partNo: 1, amount: Number(amount) || 0, status: 'received', receivedTxId: (tx as any).id }));
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ПЛАНИРУЕМЫЕ ОПЛАТЫ / ДОХОДНЫЕ МАТРИЦЫ (переиспользуем проекты)
  // ═══════════════════════════════════════════════════════════════════
  async incomeMatrix(group: string, start?: string, months = 6) {
    const projects = await this.projectRepo.find({ where: { isArchived: false } });
    const list = projects.filter(p => directionOf(p.projectType) === group && p.status !== 'planning');
    const ids = list.map(p => p.id);
    const planned = ids.length ? await this.planRepo.find({ where: { projectId: In(ids) } }) : [];
    const incomeTxs = ids.length ? await this.repo.find({ where: { projectId: In(ids), type: FinanceTxType.INCOME } }) : [];
    const paidLife: Record<string, number> = {};
    for (const t of incomeTxs) if (t.status !== FinanceTxStatus.CANCELLED && t.projectId) paidLife[t.projectId] = (paidLife[t.projectId] || 0) + Number(t.amount || 0);
    const monthsArr = this.monthWindow(start, months, planned.map(p => p.ym).concat(list.map(p => (p.startDate ? String(p.startDate).slice(0, 7) : '')).filter(Boolean)));
    const rows = list.map(p => {
      const byMonth: Record<string, any[]> = {};
      for (const ym of monthsArr) byMonth[ym] = planned.filter(pp => pp.projectId === p.id && pp.ym === ym).sort((a, b) => a.partNo - b.partNo).map(this.planDto);
      return {
        id: p.id, name: p.name, tariff: Number(p.monthlyFee) || 0, paidLife: paidLife[p.id] || 0, byMonth,
      };
    });
    return { months: monthsArr, rows };
  }

  async addPlannedPayment(projectId: string, ym: string, partNo: number, amount: number) {
    return this.planRepo.save(this.planRepo.create({ projectId, ym, partNo: partNo === 2 ? 2 : 1, amount: Number(amount) || 0, status: 'expected' }));
  }
  async addReceivedPart(projectId: string, ym: string, partNo: number, amount: number, account?: string, date?: string) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    const group = directionOf(project?.projectType);
    const tx = await this.create({
      type: FinanceTxType.INCOME, amount: Number(amount) || 0, date: date || `${ym}-01`,
      account: (account as FinanceAccount) || FinanceAccount.ALIF, category: incomeCategoryOf(group), group: group as any,
      projectId: projectId as any, description: `Оплата проекта, часть ${partNo === 2 ? 2 : 1}`, status: FinanceTxStatus.COMPLETED,
    } as any);
    await this.planRepo.save(this.planRepo.create({ projectId, ym, partNo: partNo === 2 ? 2 : 1, amount: Number(amount) || 0, status: 'received', receivedTxId: (tx as any).id }));
    return { ok: true };
  }
  async receivePlanned(plannedId: string, account?: string, date?: string) {
    const p = await this.planRepo.findOne({ where: { id: plannedId } });
    if (!p || !p.projectId) throw new NotFoundException('План не найден');
    const project = await this.projectRepo.findOne({ where: { id: p.projectId } });
    const group = directionOf(project?.projectType);
    const tx = await this.create({
      type: FinanceTxType.INCOME, amount: Number(p.amount) || 0, date: date || `${p.ym}-01`,
      account: (account as FinanceAccount) || FinanceAccount.ALIF, category: incomeCategoryOf(group), group: group as any,
      projectId: p.projectId as any, description: `Оплата проекта, часть ${p.partNo}`, status: FinanceTxStatus.COMPLETED,
    } as any);
    await this.planRepo.update(plannedId, { status: 'received', receivedTxId: (tx as any).id });
    return { ok: true };
  }
  /** Снять оплату: удалить связанную транзакцию и вернуть план в expected. */
  async unreceivePlanned(plannedId: string) {
    const p = await this.planRepo.findOne({ where: { id: plannedId } });
    if (!p) return { ok: true };
    if (p.receivedTxId) await this.repo.delete(p.receivedTxId);
    await this.planRepo.update(plannedId, { status: 'expected', receivedTxId: null });
    return { ok: true };
  }
  /** Удалить план полностью (+ его транзакцию). */
  async removePlanned(plannedId: string) {
    const p = await this.planRepo.findOne({ where: { id: plannedId } });
    if (!p) return { ok: true };
    if (p.receivedTxId) await this.repo.delete(p.receivedTxId);
    await this.planRepo.delete(plannedId);
    return { ok: true };
  }

  // ─── helpers ──────────────────────────────────────────────────────
  private planDto = (p: FinancePlannedPayment) => ({
    id: p.id, ym: p.ym, partNo: p.partNo, amount: Number(p.amount) || 0, status: p.status,
    projectId: p.projectId, debtId: p.debtId, receivedTxId: p.receivedTxId,
  });
  private monthRange(ym: string) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
  }
  private currentYm() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  private shiftYm(ym: string, delta: number) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  /** Окно из `months` месяцев: старт = переданный start ИЛИ минимум из hints, иначе (текущий − months+1). */
  private monthWindow(start: string | undefined, months: number, hints: string[]): string[] {
    let s = start;
    if (!s) {
      const valid = hints.filter(h => /^\d{4}-\d{2}$/.test(h)).sort();
      s = valid[0] || this.shiftYm(this.currentYm(), -(months - 1));
    }
    const out: string[] = [];
    for (let i = 0; i < months; i++) out.push(this.shiftYm(s, i));
    return out;
  }
}
