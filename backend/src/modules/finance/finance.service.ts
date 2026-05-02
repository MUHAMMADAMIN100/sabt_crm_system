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
  category?: FinanceCategory;
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
    const t = this.repo.create({
      ...dto,
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
    await this.repo.update(id, patch);
    return this.findOne(id);
  }

  async remove(id: string) {
    const t = await this.findOne(id);
    await this.repo.remove(t);
    return { message: 'Transaction deleted' };
  }

  // ─── AGGREGATORS ─────────────────────────────────────────────────

  /** Сводка по каждому из трёх счетов: баланс, доход, расход, кол-во.
   *  Транзакции со статусом cancelled не учитываются. */
  async getAccountsSummary() {
    const rows: Array<{ account: string; type: string; total: string; cnt: string }> = await this.repo
      .createQueryBuilder('t')
      .select('t.account', 'account')
      .addSelect('t.type', 'type')
      .addSelect('SUM(t.amount)', 'total')
      .addSelect('COUNT(*)', 'cnt')
      .where(`t.status != 'cancelled'`)
      .groupBy('t.account')
      .addGroupBy('t.type')
      .getRawMany();

    const accounts: FinanceAccount[] = [
      FinanceAccount.ALIF, FinanceAccount.DUSHANBE_CITY, FinanceAccount.CASH,
    ];
    const summary = accounts.map(acc => {
      const income  = Number(rows.find(r => r.account === acc && r.type === 'income')?.total  || 0);
      const expense = Number(rows.find(r => r.account === acc && r.type === 'expense')?.total || 0);
      const incomeCnt  = Number(rows.find(r => r.account === acc && r.type === 'income')?.cnt  || 0);
      const expenseCnt = Number(rows.find(r => r.account === acc && r.type === 'expense')?.cnt || 0);
      return {
        account: acc,
        balance: income - expense,
        income,
        expense,
        count: incomeCnt + expenseCnt,
      };
    });

    // Также «всего» по всем счетам
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
}
