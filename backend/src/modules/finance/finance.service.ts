import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  FinanceTransaction, FinanceTxType, FinanceAccount,
  FinanceCategory, FinanceTxStatus,
} from './finance-transaction.entity';

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
export class FinanceService {
  constructor(
    @InjectRepository(FinanceTransaction) private repo: Repository<FinanceTransaction>,
  ) {}

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

    const summary = accounts.map(acc => ({
      account: acc,
      balance: map[acc].income - map[acc].expense,
      income:  map[acc].income,
      expense: map[acc].expense,
      count:   map[acc].count,
    }));

    const allIncome  = summary.reduce((s, a) => s + a.income, 0);
    const allExpense = summary.reduce((s, a) => s + a.expense, 0);
    const allCount   = summary.reduce((s, a) => s + a.count, 0);

    return {
      perAccount: summary,
      total: {
        balance: allIncome - allExpense,
        income: allIncome,
        expense: allExpense,
        count: allCount,
      },
    };
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
}
