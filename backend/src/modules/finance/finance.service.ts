import {
  Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, DataSource } from 'typeorm';
import { FinanceTransaction, FinanceTxType, FinanceTxStatus } from './finance-transaction.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceDebt } from './entities/finance-debt.entity';

// ─── helpers ────────────────────────────────────────────────────────
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/** ym = 'YYYY-MM' → диапазон дат месяца [from, to]. */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const DEFAULT_ACCOUNTS = [
  { key: 'alif', name: 'Alif', position: 0 },
  { key: 'dushanbe_city', name: 'Dushanbe City', position: 1 },
  { key: 'cash', name: 'Наличные', position: 2 },
];

const DEFAULT_CATEGORIES: Array<Partial<FinanceCategory>> = [
  // Доходы
  { name: 'SMM', type: 'income', key: 'smm', builtin: true, position: 0 },
  { name: 'SMM часть 1', type: 'income', key: 'smm1', builtin: true, position: 1 },
  { name: 'SMM часть 2', type: 'income', key: 'smm2', builtin: true, position: 2 },
  { name: 'Development', type: 'income', key: 'development', builtin: true, position: 3 },
  { name: 'Design', type: 'income', key: 'design', builtin: true, position: 4 },
  { name: 'Возврат долга', type: 'income', key: 'debt_return', builtin: true, position: 5 },
  { name: 'Прочее', type: 'income', key: null, builtin: false, position: 6 },
  // Расходы
  { name: 'Зарплата', type: 'expense', key: 'salary', builtin: true, position: 7 },
  { name: 'Реклама (ADS)', type: 'expense', key: null, builtin: false, position: 8 },
  { name: 'Аренда', type: 'expense', key: 'rent', builtin: true, position: 9 },
  { name: 'Подписки', type: 'expense', key: 'subscription', builtin: true, position: 10 },
  { name: 'Транспорт', type: 'expense', key: null, builtin: false, position: 11 },
  { name: 'Печать', type: 'expense', key: null, builtin: false, position: 12 },
  { name: 'Налоги', type: 'expense', key: null, builtin: false, position: 13 },
  { name: 'Долг', type: 'expense', key: 'debt', builtin: true, position: 14 },
  { name: 'Прочее', type: 'expense', key: null, builtin: false, position: 15 },
  // Накопление
  { name: 'Накопление', type: 'saving', key: null, builtin: false, position: 16 },
];

@Injectable()
export class FinanceService implements OnModuleInit {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(FinanceTransaction) private txRepo: Repository<FinanceTransaction>,
    @InjectRepository(FinanceAccount) private accRepo: Repository<FinanceAccount>,
    @InjectRepository(FinanceCategory) private catRepo: Repository<FinanceCategory>,
    @InjectRepository(FinanceProject) private projRepo: Repository<FinanceProject>,
    @InjectRepository(FinanceEmployee) private empRepo: Repository<FinanceEmployee>,
    @InjectRepository(FinanceSubscription) private subRepo: Repository<FinanceSubscription>,
    @InjectRepository(FinanceDebt) private debtRepo: Repository<FinanceDebt>,
    private ds: DataSource,
  ) {}

  // ─── SCHEMA: таблицы/колонки создаём вручную (на проде synchronize off) ──
  async onModuleInit() {
    const run = async (sql: string) => {
      try { await this.ds.query(sql); }
      catch (e: any) { this.logger.warn(`finance DDL skipped: ${String(e?.message || e).slice(0, 160)}`); }
    };

    await run(`CREATE TABLE IF NOT EXISTS finance_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(32),
      name varchar(120) NOT NULL, "startBalance" numeric(15,2) NOT NULL DEFAULT 0,
      position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL,
      type varchar(16) NOT NULL, key varchar(32), builtin boolean NOT NULL DEFAULT false,
      position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      direction varchar(16) NOT NULL DEFAULT 'smm', tariff numeric(15,2) NOT NULL DEFAULT 0,
      note text, position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_employees (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      role varchar(120), salary numeric(15,2) NOT NULL DEFAULT 0,
      status varchar(16) NOT NULL DEFAULT 'active', position int NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      kind varchar(16) NOT NULL DEFAULT 'subscription', amount numeric(15,2) NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true, position int NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_debts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      "totalAmount" numeric(15,2) NOT NULL DEFAULT 0, "monthlyPayment" numeric(15,2) NOT NULL DEFAULT 0,
      note text, position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);

    // Новые колонки транзакции + перевод enum-полей в varchar (динамические справочники)
    for (const col of [
      `ADD COLUMN IF NOT EXISTS "accountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "fromAccountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "toAccountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "categoryId" uuid`,
      `ADD COLUMN IF NOT EXISTS "projectId" uuid`,
      `ADD COLUMN IF NOT EXISTS "employeeId" uuid`,
      `ADD COLUMN IF NOT EXISTS "debtId" uuid`,
      `ADD COLUMN IF NOT EXISTS comment text`,
    ]) await run(`ALTER TABLE finance_transactions ${col}`);

    await run(`ALTER TABLE finance_transactions ALTER COLUMN type TYPE varchar(16) USING type::text`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN account DROP NOT NULL`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN account TYPE varchar(32) USING account::text`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN description DROP NOT NULL`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN category DROP NOT NULL`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN category TYPE varchar(120) USING category::text`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN status DROP DEFAULT`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN status TYPE varchar(16) USING status::text`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN status SET DEFAULT 'completed'`);
    await run(`ALTER TABLE finance_transactions ALTER COLUMN "paymentMethod" TYPE varchar(16) USING "paymentMethod"::text`);

    await this.seedDefaults();
    // Бэкфилл: старые записи с enum-счётом → на новый accountId по ключу.
    await run(`UPDATE finance_transactions t SET "accountId" = a.id
      FROM finance_accounts a WHERE t."accountId" IS NULL AND t.account IS NOT NULL AND a.key = t.account`);
  }

  private async seedDefaults() {
    try {
      if (await this.accRepo.count() === 0) {
        await this.accRepo.save(DEFAULT_ACCOUNTS.map(a => this.accRepo.create({ ...a, startBalance: 0 })));
      }
      if (await this.catRepo.count() === 0) {
        await this.catRepo.save(DEFAULT_CATEGORIES.map(c => this.catRepo.create(c)));
      }
    } catch (e: any) {
      this.logger.warn(`finance seed skipped: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  // ─── справочники: helpers ────────────────────────────────────────
  private async maps() {
    const [accounts, categories, projects, employees, debts] = await Promise.all([
      this.accRepo.find(), this.catRepo.find(), this.projRepo.find(),
      this.empRepo.find(), this.debtRepo.find(),
    ]);
    return {
      accounts, categories, projects, employees, debts,
      acc: new Map(accounts.map(a => [a.id, a])),
      cat: new Map(categories.map(c => [c.id, c])),
      proj: new Map(projects.map(p => [p.id, p])),
      emp: new Map(employees.map(e => [e.id, e])),
      debt: new Map(debts.map(d => [d.id, d])),
    };
  }

  /** Направление дохода: по проекту, иначе по ключу категории. */
  private directionOf(tx: FinanceTransaction, m: Awaited<ReturnType<FinanceService['maps']>>): string | null {
    if (tx.projectId && m.proj.has(tx.projectId)) return m.proj.get(tx.projectId)!.direction;
    const key = tx.categoryId ? m.cat.get(tx.categoryId)?.key : null;
    if (key === 'smm' || key === 'smm1' || key === 'smm2') return 'smm';
    if (key === 'development') return 'development';
    if (key === 'design') return 'design';
    return null;
  }

  private catKey(tx: FinanceTransaction, m: Awaited<ReturnType<FinanceService['maps']>>): string | null {
    return tx.categoryId ? (m.cat.get(tx.categoryId)?.key ?? null) : null;
  }

  private active(txs: FinanceTransaction[]) {
    return txs.filter(t => t.status !== FinanceTxStatus.CANCELLED);
  }

  // ─── ОБЗОР ───────────────────────────────────────────────────────
  async overview(ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthTx = this.active(await this.txRepo.find({ where: { date: Between(from, to) } }));
    const allTx = this.active(await this.txRepo.find());

    const income = r2(monthTx.filter(t => t.type === FinanceTxType.INCOME).reduce((s, t) => s + Number(t.amount), 0));
    const expense = r2(monthTx.filter(t => t.type === FinanceTxType.EXPENSE).reduce((s, t) => s + Number(t.amount), 0));

    // Доход по направлениям
    const dirs = ['smm', 'development', 'design'];
    const planByDir: Record<string, number> = { smm: 0, development: 0, design: 0 };
    for (const p of m.projects) if (planByDir[p.direction] != null) planByDir[p.direction] += Number(p.tariff);
    const recByDir: Record<string, number> = { smm: 0, development: 0, design: 0 };
    for (const t of monthTx) {
      if (t.type !== FinanceTxType.INCOME) continue;
      const d = this.directionOf(t, m);
      if (d && recByDir[d] != null) recByDir[d] += Number(t.amount);
    }
    const incomeByDirection = dirs.map(d => ({ direction: d, received: r2(recByDir[d]), plan: r2(planByDir[d]) }));

    // Расход по статьям
    const isSalary = (t: FinanceTransaction) => !!t.employeeId || this.catKey(t, m) === 'salary';
    const isRentSub = (t: FinanceTransaction) => ['rent', 'subscription'].includes(this.catKey(t, m) || '');
    const isDebt = (t: FinanceTransaction) => !!t.debtId || this.catKey(t, m) === 'debt';
    const monthExpense = monthTx.filter(t => t.type === FinanceTxType.EXPENSE);
    const salarySpent = r2(monthExpense.filter(isSalary).reduce((s, t) => s + Number(t.amount), 0));
    const rentSubSpent = r2(monthExpense.filter(isRentSub).reduce((s, t) => s + Number(t.amount), 0));
    const debtSpent = r2(monthExpense.filter(isDebt).reduce((s, t) => s + Number(t.amount), 0));

    const salaryFund = r2(m.employees.filter(e => e.status === 'active').reduce((s, e) => s + Number(e.salary), 0));
    const subs = await this.subRepo.find();
    const rentSubPlanReal = r2(subs.filter(s => s.active).reduce((s, x) => s + Number(x.amount), 0));
    const debtPlan = r2(m.debts.reduce((s, d) => s + Number(d.monthlyPayment), 0));

    const expenseByCategory = [
      { key: 'salary', label: 'Зарплата', spent: salarySpent, plan: salaryFund },
      { key: 'rent_sub', label: 'Аренда и подписки', spent: rentSubSpent, plan: rentSubPlanReal },
      { key: 'debt', label: 'Долги', spent: debtSpent, plan: debtPlan },
    ];

    // Мини-карточки
    const recByProject: Record<string, number> = {};
    for (const t of monthTx) if (t.type === FinanceTxType.INCOME && t.projectId) recByProject[t.projectId] = (recByProject[t.projectId] || 0) + Number(t.amount);
    const expectedIncome = r2(m.projects.reduce((s, p) => s + Math.max(0, Number(p.tariff) - (recByProject[p.id] || 0)), 0));
    const salaryToPay = r2(Math.max(0, salaryFund - salarySpent));
    const totalDebt = r2(this.debtRemainingList(m.debts, allTx).reduce((s, d) => s + d.remaining, 0));
    const regularMonthly = rentSubPlanReal;

    const transactions = await this.decorate(monthTx.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 100), m);

    return {
      ym, income, expense, profit: r2(income - expense),
      incomeByDirection, expenseByCategory,
      expectedIncome, salaryToPay, salaryFund, salaryPaid: salarySpent,
      totalDebt, regularMonthly,
      transactions,
    };
  }

  private debtRemainingList(debts: FinanceDebt[], allTx: FinanceTransaction[]) {
    const paid: Record<string, number> = {};
    for (const t of allTx) if (t.type === FinanceTxType.EXPENSE && t.debtId) paid[t.debtId] = (paid[t.debtId] || 0) + Number(t.amount);
    return debts.map(d => ({
      ...d,
      totalAmount: Number(d.totalAmount), monthlyPayment: Number(d.monthlyPayment),
      paid: r2(paid[d.id] || 0),
      remaining: r2(Math.max(0, Number(d.totalAmount) - (paid[d.id] || 0))),
    }));
  }

  // ─── ДОХОД: направления и детализация ────────────────────────────
  async incomeDirections(ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthTx = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.INCOME } as any }));
    const dirs = ['smm', 'development', 'design'];
    return dirs.map(dir => {
      const projects = m.projects.filter(p => p.direction === dir);
      const received = r2(monthTx.filter(t => this.directionOf(t, m) === dir).reduce((s, t) => s + Number(t.amount), 0));
      return { direction: dir, received, plan: r2(projects.reduce((s, p) => s + Number(p.tariff), 0)), projectCount: projects.length };
    });
  }

  async incomeDirectionDetail(direction: string, ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthTx = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.INCOME } as any }));
    const allInc = this.active(await this.txRepo.find({ where: { type: FinanceTxType.INCOME } as any }));
    const projects = m.projects.filter(p => p.direction === direction);
    const rows = projects.map(p => ({
      id: p.id, name: p.name, tariff: Number(p.tariff),
      received: r2(monthTx.filter(t => t.projectId === p.id).reduce((s, t) => s + Number(t.amount), 0)),
      receivedLife: r2(allInc.filter(t => t.projectId === p.id).reduce((s, t) => s + Number(t.amount), 0)),
    }));
    return { direction, ym, rows, totalReceived: r2(rows.reduce((s, x) => s + x.received, 0)) };
  }

  // ─── РАСХОД: сводка и детализация ────────────────────────────────
  async expenseSummary(ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthExp = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.EXPENSE } as any }));
    const subs = await this.subRepo.find();
    const isSalary = (t: FinanceTransaction) => !!t.employeeId || this.catKey(t, m) === 'salary';
    const isRentSub = (t: FinanceTransaction) => ['rent', 'subscription'].includes(this.catKey(t, m) || '');
    const isDebt = (t: FinanceTransaction) => !!t.debtId || this.catKey(t, m) === 'debt';
    const sum = (arr: FinanceTransaction[]) => r2(arr.reduce((s, t) => s + Number(t.amount), 0));
    const other = monthExp.filter(t => !isSalary(t) && !isRentSub(t) && !isDebt(t));
    return {
      ym,
      salary: { spent: sum(monthExp.filter(isSalary)), count: m.employees.filter(e => e.status === 'active').length },
      subscriptions: { spent: sum(monthExp.filter(isRentSub)), count: subs.filter(s => s.active).length },
      debts: { spent: sum(monthExp.filter(isDebt)), count: m.debts.length },
      other: { spent: sum(other) },
    };
  }

  async expenseDetail(kind: string, ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthExp = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.EXPENSE } as any }));
    const allExp = this.active(await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE } as any }));

    if (kind === 'salary') {
      const rows = m.employees.map(e => ({
        id: e.id, name: e.name, role: e.role, status: e.status, salary: Number(e.salary),
        paid: r2(monthExp.filter(t => t.employeeId === e.id).reduce((s, t) => s + Number(t.amount), 0)),
      })).map(e => ({ ...e, toPay: r2(Math.max(0, e.salary - e.paid)) }));
      return { kind, ym, rows };
    }
    if (kind === 'subscriptions') {
      const subs = await this.subRepo.find({ order: { position: 'ASC' } });
      const spent = r2(monthExp.filter(t => ['rent', 'subscription'].includes(this.catKey(t, m) || '')).reduce((s, t) => s + Number(t.amount), 0));
      return { kind, ym, rows: subs.map(s => ({ ...s, amount: Number(s.amount) })), spent };
    }
    if (kind === 'debts') {
      const rows = this.debtRemainingList(m.debts, allExp);
      const spentThisMonth = r2(monthExp.filter(t => !!t.debtId || this.catKey(t, m) === 'debt').reduce((s, t) => s + Number(t.amount), 0));
      return { kind, ym, rows, spentThisMonth };
    }
    // other
    const isSalary = (t: FinanceTransaction) => !!t.employeeId || this.catKey(t, m) === 'salary';
    const isRentSub = (t: FinanceTransaction) => ['rent', 'subscription'].includes(this.catKey(t, m) || '');
    const isDebt = (t: FinanceTransaction) => !!t.debtId || this.catKey(t, m) === 'debt';
    const other = monthExp.filter(t => !isSalary(t) && !isRentSub(t) && !isDebt(t));
    return { kind: 'other', ym, rows: await this.decorate(other, m), spent: r2(other.reduce((s, t) => s + Number(t.amount), 0)) };
  }

  // ─── СЧЕТА и БАЛАНСЫ ─────────────────────────────────────────────
  async accountsBalances() {
    const accounts = await this.accRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
    const txs = this.active(await this.txRepo.find());
    const perAccount = accounts.map(a => {
      let income = 0, expense = 0, transferIn = 0, transferOut = 0, saving = 0;
      for (const t of txs) {
        const amt = Number(t.amount);
        if (t.type === FinanceTxType.INCOME && t.accountId === a.id) income += amt;
        else if (t.type === FinanceTxType.EXPENSE && t.accountId === a.id) expense += amt;
        else if (t.type === FinanceTxType.SAVING && t.accountId === a.id) saving += amt;
        else if (t.type === FinanceTxType.TRANSFER) {
          if (t.fromAccountId === a.id) transferOut += amt;
          if (t.toAccountId === a.id) transferIn += amt;
        }
      }
      const balance = r2(Number(a.startBalance) + income + saving + transferIn - expense - transferOut);
      return {
        id: a.id, key: a.key, name: a.name, startBalance: Number(a.startBalance),
        income: r2(income), expense: r2(expense), saving: r2(saving),
        transferIn: r2(transferIn), transferOut: r2(transferOut), balance,
      };
    });
    return {
      perAccount,
      total: {
        startBalance: r2(perAccount.reduce((s, a) => s + a.startBalance, 0)),
        balance: r2(perAccount.reduce((s, a) => s + a.balance, 0)),
        income: r2(perAccount.reduce((s, a) => s + a.income, 0)),
        expense: r2(perAccount.reduce((s, a) => s + a.expense, 0)),
      },
    };
  }

  // ─── ТРАНЗАКЦИИ ──────────────────────────────────────────────────
  private async decorate(txs: FinanceTransaction[], m: Awaited<ReturnType<FinanceService['maps']>>) {
    return txs.map(t => ({
      id: t.id, type: t.type, amount: Number(t.amount), date: t.date, comment: t.comment,
      accountId: t.accountId, accountName: t.accountId ? m.acc.get(t.accountId)?.name ?? null : null,
      fromAccountId: t.fromAccountId, fromAccountName: t.fromAccountId ? m.acc.get(t.fromAccountId)?.name ?? null : null,
      toAccountId: t.toAccountId, toAccountName: t.toAccountId ? m.acc.get(t.toAccountId)?.name ?? null : null,
      categoryId: t.categoryId, categoryName: t.categoryId ? m.cat.get(t.categoryId)?.name ?? null : (t.category ?? null),
      projectId: t.projectId, projectName: t.projectId ? m.proj.get(t.projectId)?.name ?? null : null,
      employeeId: t.employeeId, employeeName: t.employeeId ? m.emp.get(t.employeeId)?.name ?? null : null,
      debtId: t.debtId, debtName: t.debtId ? m.debt.get(t.debtId)?.name ?? null : null,
    }));
  }

  async listTransactions(f: { type?: string; search?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
    const m = await this.maps();
    const qb = this.txRepo.createQueryBuilder('t').where(`COALESCE(t.status,'completed') <> 'cancelled'`);
    if (f.type) qb.andWhere('t.type = :type', { type: f.type });
    if (f.from) qb.andWhere('t.date >= :from', { from: f.from });
    if (f.to) qb.andWhere('t.date <= :to', { to: f.to });
    if (f.search) qb.andWhere('(t.comment ILIKE :s OR t.category ILIKE :s)', { s: `%${f.search}%` });
    qb.orderBy('t.date', 'DESC').addOrderBy('t.createdAt', 'DESC');

    const page = Math.max(1, f.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 100));
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();
    return { items: await this.decorate(items, m), total, page, pageSize };
  }

  /** Создать операцию любого типа из модалки «+ Операция». */
  async createOperation(dto: any, createdById?: string) {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    const type = dto.type as FinanceTxType;
    if (![FinanceTxType.INCOME, FinanceTxType.EXPENSE, FinanceTxType.TRANSFER, FinanceTxType.SAVING].includes(type))
      throw new BadRequestException('Неизвестный тип операции');
    const date = dto.date || new Date().toISOString().slice(0, 10);

    const base: Partial<FinanceTransaction> = {
      type, amount, date, comment: dto.comment ?? null, createdById: createdById,
      status: FinanceTxStatus.COMPLETED,
    };

    if (type === FinanceTxType.TRANSFER) {
      if (!dto.fromAccountId || !dto.toAccountId) throw new BadRequestException('Укажите счёт списания и зачисления');
      if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Счета перевода должны отличаться');
      base.fromAccountId = dto.fromAccountId;
      base.toAccountId = dto.toAccountId;
    } else {
      if (!dto.accountId) throw new BadRequestException('Укажите счёт');
      base.accountId = dto.accountId;
      base.categoryId = dto.categoryId ?? null;
      if (dto.categoryId) base.category = (await this.catRepo.findOne({ where: { id: dto.categoryId } }))?.name ?? null;
      if (type === FinanceTxType.INCOME) base.projectId = dto.projectId ?? null;
      if (type === FinanceTxType.EXPENSE) { base.employeeId = dto.employeeId ?? null; base.debtId = dto.debtId ?? null; }
    }
    return this.txRepo.save(this.txRepo.create(base));
  }

  async updateTransaction(id: string, dto: any) {
    const t = await this.txRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Операция не найдена');
    if (dto.amount != null) {
      const a = Number(dto.amount);
      if (!Number.isFinite(a) || a <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    }
    const patch: any = {};
    for (const k of ['amount', 'date', 'comment', 'categoryId', 'accountId', 'fromAccountId', 'toAccountId', 'projectId', 'employeeId', 'debtId', 'type']) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (patch.categoryId !== undefined) patch.category = patch.categoryId ? (await this.catRepo.findOne({ where: { id: patch.categoryId } }))?.name ?? null : null;
    await this.txRepo.update(id, patch);
    return this.txRepo.findOne({ where: { id } });
  }

  async removeTransaction(id: string) {
    await this.txRepo.delete(id);
    return { ok: true };
  }

  // ─── CRUD справочников ───────────────────────────────────────────
  // Счета
  listAccounts() { return this.accRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createAccount(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = (await this.accRepo.count());
    return this.accRepo.save(this.accRepo.create({ name: dto.name.trim(), startBalance: Number(dto.startBalance) || 0, position }));
  }
  async updateAccount(id: string, dto: any) {
    const a = await this.accRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Счёт не найден');
    if (dto.name !== undefined) a.name = String(dto.name).trim();
    if (dto.startBalance !== undefined) a.startBalance = Number(dto.startBalance) || 0;
    return this.accRepo.save(a);
  }
  async removeAccount(id: string) {
    const used = await this.txRepo.count({ where: [{ accountId: id }, { fromAccountId: id }, { toAccountId: id }] as any });
    if (used > 0) throw new BadRequestException('По счёту есть операции — удаление запрещено');
    await this.accRepo.delete(id);
    return { ok: true };
  }

  // Категории
  listCategories() { return this.catRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createCategory(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const type = ['income', 'expense', 'saving'].includes(dto.type) ? dto.type : 'expense';
    const position = (await this.catRepo.count()) + 100;
    return this.catRepo.save(this.catRepo.create({ name: dto.name.trim(), type, key: null, builtin: false, position }));
  }
  async updateCategory(id: string, dto: any) {
    const c = await this.catRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Категория не найдена');
    if (dto.name !== undefined) c.name = String(dto.name).trim();
    if (dto.type !== undefined && !c.builtin && ['income', 'expense', 'saving'].includes(dto.type)) c.type = dto.type;
    return this.catRepo.save(c);
  }
  async removeCategory(id: string) {
    const c = await this.catRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Категория не найдена');
    if (c.builtin) throw new BadRequestException('Системную категорию нельзя удалить');
    await this.catRepo.delete(id);
    return { ok: true };
  }

  // Проекты/клиенты
  listProjects() { return this.projRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createProject(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const direction = ['smm', 'development', 'design'].includes(dto.direction) ? dto.direction : 'smm';
    const position = await this.projRepo.count();
    return this.projRepo.save(this.projRepo.create({ name: dto.name.trim(), direction, tariff: Number(dto.tariff) || 0, note: dto.note ?? null, position }));
  }
  async updateProject(id: string, dto: any) {
    const p = await this.projRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Проект не найден');
    if (dto.name !== undefined) p.name = String(dto.name).trim();
    if (dto.direction !== undefined && ['smm', 'development', 'design'].includes(dto.direction)) p.direction = dto.direction;
    if (dto.tariff !== undefined) p.tariff = Number(dto.tariff) || 0;
    if (dto.note !== undefined) p.note = dto.note;
    return this.projRepo.save(p);
  }
  async removeProject(id: string) { await this.projRepo.delete(id); return { ok: true }; }

  // Сотрудники
  listEmployees() { return this.empRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createEmployee(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Имя обязательно');
    const position = await this.empRepo.count();
    return this.empRepo.save(this.empRepo.create({
      name: dto.name.trim(), role: dto.role ?? null, salary: Number(dto.salary) || 0,
      status: dto.status === 'inactive' ? 'inactive' : 'active', position,
    }));
  }
  async updateEmployee(id: string, dto: any) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    if (dto.name !== undefined) e.name = String(dto.name).trim();
    if (dto.role !== undefined) e.role = dto.role;
    if (dto.salary !== undefined) e.salary = Number(dto.salary) || 0;
    if (dto.status !== undefined) e.status = dto.status === 'inactive' ? 'inactive' : 'active';
    return this.empRepo.save(e);
  }
  async removeEmployee(id: string) { await this.empRepo.delete(id); return { ok: true }; }

  // Подписки/аренда
  listSubscriptions() { return this.subRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createSubscription(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = await this.subRepo.count();
    return this.subRepo.save(this.subRepo.create({
      name: dto.name.trim(), kind: dto.kind === 'rent' ? 'rent' : 'subscription',
      amount: Number(dto.amount) || 0, active: dto.active !== false, position,
    }));
  }
  async updateSubscription(id: string, dto: any) {
    const s = await this.subRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Позиция не найдена');
    if (dto.name !== undefined) s.name = String(dto.name).trim();
    if (dto.kind !== undefined) s.kind = dto.kind === 'rent' ? 'rent' : 'subscription';
    if (dto.amount !== undefined) s.amount = Number(dto.amount) || 0;
    if (dto.active !== undefined) s.active = !!dto.active;
    return this.subRepo.save(s);
  }
  async removeSubscription(id: string) { await this.subRepo.delete(id); return { ok: true }; }

  // Долги
  async listDebts() {
    const debts = await this.debtRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
    const allExp = this.active(await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE } as any }));
    return this.debtRemainingList(debts, allExp);
  }
  async createDebt(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = await this.debtRepo.count();
    return this.debtRepo.save(this.debtRepo.create({
      name: dto.name.trim(), totalAmount: Number(dto.totalAmount) || 0,
      monthlyPayment: Number(dto.monthlyPayment) || 0, note: dto.note ?? null, position,
    }));
  }
  async updateDebt(id: string, dto: any) {
    const d = await this.debtRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Долг не найден');
    if (dto.name !== undefined) d.name = String(dto.name).trim();
    if (dto.totalAmount !== undefined) d.totalAmount = Number(dto.totalAmount) || 0;
    if (dto.monthlyPayment !== undefined) d.monthlyPayment = Number(dto.monthlyPayment) || 0;
    if (dto.note !== undefined) d.note = dto.note;
    return this.debtRepo.save(d);
  }
  async removeDebt(id: string) { await this.debtRepo.delete(id); return { ok: true }; }

  // ─── Резервная копия / сброс ─────────────────────────────────────
  async exportAll() {
    const [accounts, categories, projects, employees, subscriptions, debts, transactions] = await Promise.all([
      this.accRepo.find(), this.catRepo.find(), this.projRepo.find(), this.empRepo.find(),
      this.subRepo.find(), this.debtRepo.find(), this.txRepo.find(),
    ]);
    return { version: 1, exportedAt: new Date().toISOString(), accounts, categories, projects, employees, subscriptions, debts, transactions };
  }

  async importAll(data: any) {
    if (!data || typeof data !== 'object') throw new BadRequestException('Неверный формат файла');
    await this.resetAll(false);
    const save = async (repo: Repository<any>, rows: any[]) => { if (Array.isArray(rows) && rows.length) await repo.save(rows); };
    await save(this.accRepo, data.accounts);
    await save(this.catRepo, data.categories);
    await save(this.projRepo, data.projects);
    await save(this.empRepo, data.employees);
    await save(this.subRepo, data.subscriptions);
    await save(this.debtRepo, data.debts);
    await save(this.txRepo, data.transactions);
    if (!(data.accounts?.length) && !(data.categories?.length)) await this.seedDefaults();
    return { ok: true };
  }

  /** Полный сброс финансовых данных. reseed=true → пересоздаёт дефолты. */
  async resetAll(reseed = true) {
    await this.txRepo.createQueryBuilder().delete().execute();
    await this.debtRepo.createQueryBuilder().delete().execute();
    await this.subRepo.createQueryBuilder().delete().execute();
    await this.empRepo.createQueryBuilder().delete().execute();
    await this.projRepo.createQueryBuilder().delete().execute();
    await this.catRepo.createQueryBuilder().delete().execute();
    await this.accRepo.createQueryBuilder().delete().execute();
    if (reseed) await this.seedDefaults();
    return { ok: true };
  }
}
