import {
  Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, DataSource, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { FinanceTransaction, FinanceTxType, FinanceTxStatus } from './finance-transaction.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceDebt } from './entities/finance-debt.entity';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { WEBRAND_BACKUP } from './webrand-backup.data';
import { FinanceScheduler } from './finance.scheduler';
import {
  NOTION_ACCOUNTS, NOTION_PROJECT_RENAMES, NOTION_PROJECTS,
  NOTION_EMPLOYEES, NOTION_TRANSACTIONS,
} from './notion-snapshot.data';

// ─── helpers ────────────────────────────────────────────────────────
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

/** ym = 'YYYY-MM' → диапазон дат месяца [from, to]. */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const ymOf = (iso: string): string => (iso || '').slice(0, 7);

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function currentYm(): string { return ymOf(todayISO()); }

/** Сдвиг месяца 'YYYY-MM' на delta месяцев. */
function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** День месяца оплаты (1..31) по дате контракта, или null. */
function contractDay(contractDate?: string | null): number | null {
  if (!contractDate || contractDate.length < 10) return null;
  const d = Number(contractDate.slice(8, 10));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Дата оплаты в указанном месяце (ISO) с учётом длины месяца. */
function dueDateForMonth(ym: string, day: number): string {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${ym}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** ISO-дата + delta дней. */
function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Срок второй части после оплаты первой — 20 дней (правило компании). */
const PART2_DUE_DAYS = 20;

/** Бонус сотрудника за месяц (jsonb bonuses: { '2026-07': 500 }). */
function bonusOf(e: { bonuses?: Record<string, number> | null }, ym: string): number {
  return r2(Number((e.bonuses || {})[ym]) || 0);
}

/** Действующий якорь SMM-цикла: дата последней полной оплаты или дата контракта. */
function smmAnchor(p: { cycleAnchor?: string | null; contractDate?: string | null }): string | null {
  return p.cycleAnchor || p.contractDate || null;
}

const DEFAULT_ACCOUNTS = [
  { key: 'alif', name: 'Alif', position: 0 },
  { key: 'dushanbe_city', name: 'Dushanbe City', position: 1 },
  { key: 'cash', name: 'Наличные', position: 2 },
];

const DEFAULT_CATEGORIES: Array<Partial<FinanceCategory>> = [
  // Доходы
  { name: 'SMM', type: 'income', key: 'smm', builtin: true, icon: 'smm', color: '#16a34a', position: 0 },
  { name: 'SMM часть 1', type: 'income', key: 'smm1', builtin: true, icon: 'smm', color: '#16a34a', position: 1 },
  { name: 'SMM часть 2', type: 'income', key: 'smm2', builtin: true, icon: 'smm', color: '#22c55e', position: 2 },
  { name: 'Development', type: 'income', key: 'development', builtin: true, icon: 'development', color: '#0ea5e9', position: 3 },
  { name: 'Design', type: 'income', key: 'design', builtin: true, icon: 'design', color: '#a855f7', position: 4 },
  { name: 'Возврат долга', type: 'income', key: 'debt_return', builtin: true, icon: 'plus', color: '#14b8a6', position: 5 },
  { name: 'Прочее', type: 'income', key: null, builtin: false, icon: 'dots', color: '#64748b', position: 6 },
  // Расходы
  { name: 'Зарплата', type: 'expense', key: 'salary', builtin: true, icon: 'salary', color: '#f97316', position: 7 },
  { name: 'Реклама (ADS)', type: 'expense', key: null, builtin: false, icon: 'target', color: '#ef4444', position: 8 },
  { name: 'Аренда', type: 'expense', key: 'rent', builtin: true, icon: 'building', color: '#e11d48', position: 9 },
  { name: 'Подписки', type: 'expense', key: 'subscription', builtin: true, icon: 'transactions', color: '#d946ef', position: 10 },
  { name: 'Транспорт', type: 'expense', key: null, builtin: false, icon: 'car', color: '#0891b2', position: 11 },
  { name: 'Печать', type: 'expense', key: null, builtin: false, icon: 'printer', color: '#7c3aed', position: 12 },
  { name: 'Налоги', type: 'expense', key: null, builtin: false, icon: 'percent', color: '#b45309', position: 13 },
  { name: 'Долг', type: 'expense', key: 'debt', builtin: true, icon: 'receipt', color: '#d97706', position: 14 },
  { name: 'Прочее', type: 'expense', key: null, builtin: false, icon: 'dots', color: '#64748b', position: 15 },
  // Накопление
  { name: 'Накопление', type: 'saving', key: null, builtin: false, icon: 'income', color: '#7c3aed', position: 16 },
];

/** Направление → системный ключ категории дохода. */
const DIRECTION_CATEGORY_KEY: Record<string, string> = {
  smm: 'smm', development: 'development', design: 'design',
};

/** Справочники + индексы по id (кэш на один запрос). */
interface FinMaps {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  projects: FinanceProject[];
  employees: FinanceEmployee[];
  debts: FinanceDebt[];
  acc: Map<string, FinanceAccount>;
  cat: Map<string, FinanceCategory>;
  proj: Map<string, FinanceProject>;
  emp: Map<string, FinanceEmployee>;
  debt: Map<string, FinanceDebt>;
}

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
    @InjectRepository(FinancePlannedPayment) private ppRepo: Repository<FinancePlannedPayment>,
    private ds: DataSource,
    private scheduler: FinanceScheduler,
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
      color varchar(16), kind varchar(16),
      position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL,
      type varchar(16) NOT NULL, key varchar(32), builtin boolean NOT NULL DEFAULT false,
      position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE TABLE IF NOT EXISTS finance_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      direction varchar(16) NOT NULL DEFAULT 'smm', tariff numeric(15,2) NOT NULL DEFAULT 0,
      status varchar(16) DEFAULT 'active',
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

    // Новые колонки справочников (расширенная финансовая модель).
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "contractDate" date`);
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "cycleAnchor" date`);
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false`);
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "multiMonth" boolean NOT NULL DEFAULT false`);
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'active'`);
    await run(`ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS "color" varchar(16)`);
    await run(`ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS "kind" varchar(16)`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "advance" numeric(15,2) NOT NULL DEFAULT 0`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "hireDate" date`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "bonuses" jsonb`);
    await run(`ALTER TABLE finance_categories ADD COLUMN IF NOT EXISTS "icon" varchar(40)`);
    await run(`ALTER TABLE finance_categories ADD COLUMN IF NOT EXISTS "color" varchar(16)`);
    await run(`ALTER TABLE finance_debts ADD COLUMN IF NOT EXISTS "counterparty" varchar(200)`);
    await run(`ALTER TABLE finance_debts ADD COLUMN IF NOT EXISTS "paidBefore" numeric(15,2) NOT NULL DEFAULT 0`);
    // Таблицы subscriptions/debts на проде созданы старой версией БЕЗ position —
    // без этих ALTER'ов любые SELECT/INSERT по ним падают и рушат сид целиком.
    await run(`ALTER TABLE finance_subscriptions ADD COLUMN IF NOT EXISTS "position" int NOT NULL DEFAULT 0`);
    await run(`ALTER TABLE finance_debts ADD COLUMN IF NOT EXISTS "position" int NOT NULL DEFAULT 0`);
    // Отметки «оплачено без операции» по месяцам (см. FinanceSubscription.paidMarks).
    await run(`ALTER TABLE finance_subscriptions ADD COLUMN IF NOT EXISTS "paidMarks" jsonb`);

    // Плановые оплаты (SMM части, матрицы Dev/Design, график долгов).
    await run(`CREATE TABLE IF NOT EXISTS finance_planned_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid, "debtId" uuid,
      ym varchar(7), "partNo" int DEFAULT 1, amount numeric(15,2) DEFAULT 0,
      status varchar(16) DEFAULT 'expected', "receivedTxId" uuid, auto boolean DEFAULT false,
      "createdAt" timestamptz DEFAULT now())`);
    await run(`ALTER TABLE finance_planned_payments ADD COLUMN IF NOT EXISTS "dueDate" date`);
    await run(`CREATE INDEX IF NOT EXISTS idx_fpp_project ON finance_planned_payments("projectId")`);
    await run(`CREATE INDEX IF NOT EXISTS idx_fpp_debt ON finance_planned_payments("debtId")`);
    await run(`CREATE INDEX IF NOT EXISTS idx_fpp_ym ON finance_planned_payments(ym)`);

    // Новые колонки транзакции + перевод enum-полей в varchar (динамические справочники)
    for (const col of [
      `ADD COLUMN IF NOT EXISTS "accountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "fromAccountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "toAccountId" uuid`,
      `ADD COLUMN IF NOT EXISTS "categoryId" uuid`,
      `ADD COLUMN IF NOT EXISTS "projectId" uuid`,
      `ADD COLUMN IF NOT EXISTS "employeeId" uuid`,
      `ADD COLUMN IF NOT EXISTS "debtId" uuid`,
      `ADD COLUMN IF NOT EXISTS "subscriptionId" uuid`,
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
    // Legacy: сотрудники со статусом 'inactive' → 'fired'.
    await run(`UPDATE finance_employees SET status = 'fired' WHERE status = 'inactive'`);
  }

  private async seedDefaults() {
    try {
      if (await this.accRepo.count() === 0) {
        await this.accRepo.save(DEFAULT_ACCOUNTS.map(a => this.accRepo.create({ ...a, startBalance: 0 })));
      }
      if (await this.catRepo.count() === 0) {
        await this.catRepo.save(DEFAULT_CATEGORIES.map(c => this.catRepo.create(c)));
      } else {
        await this.backfillCategoryIcons();
      }
      await this.seedWebRand();
      await this.seedNotionSnapshot();
      await this.linkNotionSubscriptionPayments();
      await this.linkNotionSmmParts();
    } catch (e: any) {
      this.logger.warn(`finance seed skipped: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  /** Оплаты SMM-клиентов из Notion, разнесённые по частям (июнь–июль 2026):
   *  полученные части привязываются к УЖЕ существующим операциям журнала
   *  (денег не двигает — балансы не меняются), ожидаемые получают срок из
   *  заметок Notion («24/28/30 июля второй транш», «9 июля за июль», «за июль
   *  не оплачено»). Идемпотентно: по ключу (проект, месяц, часть); разовая
   *  правка данных — после 2026-08-15 не выполняется. */
  private async linkNotionSmmParts() {
    if (todayISO() > '2026-08-15') return;
    const projByName = new Map((await this.projRepo.find()).map(p => [p.name, p]));

    const findTx = async (comment: string, date: string, amount: number) => {
      const txs = await this.txRepo.find({ where: { type: FinanceTxType.INCOME, date, comment } as any });
      return txs.find(t => Number(t.amount) === amount) ?? null;
    };
    const ensure = async (
      projName: string, ym: string, partNo: number, amount: number,
      status: 'received' | 'expected',
      opts: { due?: string; tx?: [string, string, number] } = {},
    ) => {
      const p = projByName.get(projName);
      if (!p) return;
      if (await this.ppRepo.findOne({ where: { projectId: p.id, ym, partNo } as any })) return;
      let receivedTxId: string | null = null;
      if (status === 'received' && opts.tx) {
        const tx = await findTx(...opts.tx);
        if (!tx) return; // операция журнала не найдена — не выдумываем оплату
        receivedTxId = tx.id;
      }
      await this.ppRepo.save(this.ppRepo.create({
        projectId: p.id, ym, partNo, amount, status,
        receivedTxId, dueDate: opts.due ?? null, auto: false,
      }));
    };

    // Частично оплаченные: часть 1 = операция журнала, часть 2 = срок из заметки.
    await ensure('Клиника Жасмин', '2026-06', 1, 1500, 'received', { tx: ['Клиника Жасмин — остаток 2к от 3500', '2026-06-26', 1500] });
    await ensure('Клиника Жасмин', '2026-06', 2, 2000, 'expected', { due: '2026-07-24' });
    await ensure('Сеченак', '2026-06', 1, 2100, 'received', { tx: ['Оплата за Сеченак — Тариф 3500', '2026-06-30', 2100] });
    await ensure('Сеченак', '2026-06', 2, 1400, 'expected', { due: '2026-07-28' });
    // Индотач: 800 + 850 = 1650 одной частью (обе оплаты 4 июля, привязка к большей).
    await ensure('Клиника Индотач', '2026-07', 1, 1650, 'received', { tx: ['Проект Индотач — У Мухаммада', '2026-07-04', 850] });
    await ensure('Клиника Индотач', '2026-07', 2, 1850, 'expected', { due: '2026-07-30' });
    // Аке: июнь закрыт двумя частями (первая — в сиде), июль ждём к 9-му.
    await ensure('Аке Нем Центр', '2026-06', 2, 1750, 'received', { tx: ['Оплата за Аке', '2026-06-30', 1750] });
    await ensure('Аке Нем Центр', '2026-07', 1, 3500, 'expected', { due: '2026-07-09' });
    // Ирам синема: июльская оплата целиком.
    await ensure('Iram cinema', '2026-07', 1, 3500, 'received', { tx: ['Ирам синема', '2026-07-02', 3500] });
    // «За июль не оплачено» — ожидаем с начала месяца (день контракта = 1-е).
    await ensure('Asan', '2026-07', 1, 2500, 'expected', { due: '2026-07-01' });
    await ensure('Furug clinic', '2026-07', 1, 3000, 'expected', { due: '2026-07-01' });
  }

  /** Оплаты аренды/подписок июля из снимка Notion: привязывает уже
   *  существующие операции журнала к позициям (балансы счетов не меняются —
   *  деньги уже списаны этими операциями) и отмечает Adobe оплаченным без
   *  операции (2026-07-02). Идемпотентно: операции ищутся по точному
   *  фингерпринту (комментарий+дата+сумма) и только пока не привязаны;
   *  после 2026-08-15 не выполняется вовсе — это разовая правка данных. */
  private async linkNotionSubscriptionPayments() {
    if (todayISO() > '2026-08-15') return;
    const subs = await this.subRepo.find();
    const byName = new Map(subs.map(s => [s.name, s]));

    const link = async (subName: string, comment: string, date: string, amounts: number[]) => {
      const s = byName.get(subName);
      if (!s) return;
      const txs = await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE, date, comment } as any });
      for (const t of txs) {
        if (!t.subscriptionId && amounts.includes(Number(t.amount))) {
          t.subscriptionId = s.id;
          await this.txRepo.save(t);
        }
      }
    };
    await link('Аренда офиса', 'Аренда офиса 2', '2026-07-06', [2000, 4000]);
    await link('Claude', 'Подписка на клауд', '2026-07-04', [1860]);

    const adobe = byName.get('Adobe');
    if (adobe && !(adobe.paidMarks || []).some(x => x.ym === '2026-07')) {
      adobe.paidMarks = [...(adobe.paidMarks || []), { ym: '2026-07', date: '2026-07-02' }];
      await this.subRepo.save(adobe);
    }
  }

  /** Снимок реальных данных из Notion (2026-07-07): счета, клиенты, авансы,
   *  журнал операций. Применяется ОДИН раз — только пока журнал пуст; после
   *  первой транзакции (своей или из снимка) больше никогда не трогает БД. */
  private async seedNotionSnapshot() {
    if ((await this.txRepo.count()) > 0) return;

    // Счета: имена как в Notion + стартовые остатки, дающие точные балансы.
    const accounts = await this.accRepo.find();
    const accByKey = new Map(accounts.filter(a => a.key).map(a => [a.key as string, a]));
    for (const na of NOTION_ACCOUNTS) {
      const a = accByKey.get(na.key);
      if (!a) continue;
      a.name = na.name;
      a.startBalance = na.startBalance;
      if (!a.color) a.color = na.color;
      await this.accRepo.save(a);
    }

    // Клиенты: чиним искажённые имена старого сида (id сохраняются — плановые
    // оплаты не ломаются), затем приводим карточки к Notion; недостающих создаём.
    const projects = await this.projRepo.find();
    const projByName = new Map(projects.map(p => [p.name, p]));
    for (const [oldName, newName] of Object.entries(NOTION_PROJECT_RENAMES)) {
      const p = projByName.get(oldName);
      if (!p || projByName.has(newName)) continue;
      projByName.delete(oldName);
      p.name = newName;
      projByName.set(newName, p);
    }
    for (let i = 0; i < NOTION_PROJECTS.length; i++) {
      const np = NOTION_PROJECTS[i];
      const p = projByName.get(np.name) ?? this.projRepo.create({ name: np.name, direction: 'smm' });
      p.tariff = np.tariff;
      p.contractDate = np.contractDate;
      p.note = np.note;
      p.archived = np.archived;
      p.status = np.archived ? 'archived' : 'active';
      p.position = i;
      await this.projRepo.save(p);
      projByName.set(np.name, p);
    }
    // Dev-проекты (Javonon, Arhideya) не из Notion — просто сдвигаем в конец списка.
    let tailPos = NOTION_PROJECTS.length;
    for (const p of projects.filter(x => x.direction !== 'smm').sort((a, b) => a.position - b.position)) {
      p.position = tailPos++;
      await this.projRepo.save(p);
    }

    // Сотрудники: ЗП и авансы из Notion; недостающих создаём.
    const empByName = new Map((await this.empRepo.find()).map(e => [e.name, e]));
    for (const ne of NOTION_EMPLOYEES) {
      const e = empByName.get(ne.name)
        ?? this.empRepo.create({ name: ne.name, role: ne.role, hireDate: ne.hireDate, status: 'active', position: empByName.size });
      e.salary = ne.salary;
      e.advance = ne.advance;
      await this.empRepo.save(e);
    }

    // Категории журнала: находим по имени+типу (создаём, если удалили).
    const cats = await this.catRepo.find();
    const catOf = async (name: string, type: string): Promise<FinanceCategory> => {
      const found = cats.find(c => c.name === name && c.type === type);
      if (found) return found;
      const created = await this.catRepo.save(this.catRepo.create({ name, type: type as any, position: cats.length }));
      cats.push(created);
      return created;
    };

    // Журнал: 24 операции одним save() (одна транзакция БД — всё или ничего).
    // createdAt убывает с индексом: внутри одного дня порядок как в Notion.
    const base = Date.parse('2026-07-07T12:00:00.000Z');
    const rows: FinanceTransaction[] = [];
    for (let i = 0; i < NOTION_TRANSACTIONS.length; i++) {
      const t = NOTION_TRANSACTIONS[i];
      const cat = t.cat ? await catOf(t.cat[0], t.cat[1]) : null;
      rows.push(this.txRepo.create({
        type: t.type as FinanceTxType,
        amount: t.amount,
        date: t.date,
        accountId: t.account ? accByKey.get(t.account)?.id ?? null : null,
        fromAccountId: t.from ? accByKey.get(t.from)?.id ?? null : null,
        toAccountId: t.to ? accByKey.get(t.to)?.id ?? null : null,
        categoryId: cat?.id ?? null,
        category: cat?.name ?? null,
        account: t.account ?? null,
        projectId: t.project ? projByName.get(t.project)?.id ?? null : null,
        comment: t.comment,
        status: FinanceTxStatus.COMPLETED,
        createdAt: new Date(base - i * 60000),
      }));
    }
    await this.txRepo.save(rows);
    this.logger.log(`finance: применён снимок Notion — ${rows.length} операций, ${NOTION_PROJECTS.length} клиентов, ${NOTION_EMPLOYEES.length} сотрудников`);
  }

  /** Проставить icon/color существующим категориям (по позиции) — идемпотентно. */
  private async backfillCategoryIcons() {
    const cats = await this.catRepo.find();
    const byPos = new Map(DEFAULT_CATEGORIES.map(c => [c.position, c]));
    const changed: FinanceCategory[] = [];
    for (const c of cats) {
      if (c.icon == null || c.color == null) {
        const d = byPos.get(c.position);
        if (d) {
          if (c.icon == null && d.icon != null) c.icon = d.icon;
          if (c.color == null && d.color != null) c.color = d.color;
          changed.push(c);
        }
      }
    }
    if (changed.length) await this.catRepo.save(changed);
  }

  /** Демо-данные WebRand (из Dexie-бэкапа). Каждый блок — только если
   *  целевая таблица пуста; никогда не дублирует и не затирает данные. */
  private async seedWebRand() {
    const backup = this.readWebRandBackup();
    if (!backup) return;

    // Счета: стартовые балансы (только если ещё 0 — не затираем) + цвета точек (§4.1).
    const startByKey: Record<string, number> = { alif: 1090, dushanbe_city: 1644, cash: 5500 };
    const startByName: Record<string, number> = { Alif: 1090, DC: 1644, 'Dushanbe City': 1644, 'Наличные': 5500 };
    const colorByKey: Record<string, string> = { alif: '#22c55e', dushanbe_city: '#f59e0b', cash: '#94a3b8' };
    const colorByName: Record<string, string> = { Alif: '#22c55e', DC: '#f59e0b', 'Dushanbe City': '#f59e0b', 'Наличные': '#94a3b8' };
    const accounts = await this.accRepo.find();
    for (const a of accounts) {
      let dirty = false;
      const sb = a.key && startByKey[a.key] != null ? startByKey[a.key] : startByName[a.name];
      if (sb != null && Number(a.startBalance) === 0) { a.startBalance = sb; dirty = true; }
      const col = (a.key && colorByKey[a.key]) || colorByName[a.name];
      if (col && !a.color) { a.color = col; dirty = true; }
      if (dirty) await this.accRepo.save(a);
    }

    // Проекты/клиенты.
    if ((await this.projRepo.count()) === 0 && Array.isArray(backup.clients)) {
      const rows = backup.clients.map((c: any, i: number) => this.projRepo.create({
        name: c.name,
        direction: ['smm', 'development', 'design'].includes(c.group) ? c.group : 'smm',
        tariff: Number(c.tariff) || 0,
        contractDate: c.contractDate || null,
        archived: c.status === 'archived',
        multiMonth: !!c.multiMonth,
        note: c.note ?? null,
        position: i,
      }));
      if (rows.length) await this.projRepo.save(rows);
    }

    // Сотрудники.
    if ((await this.empRepo.count()) === 0 && Array.isArray(backup.employees)) {
      const rows = backup.employees.map((e: any, i: number) => this.empRepo.create({
        name: e.name, role: e.role ?? null, salary: Number(e.salary) || 0,
        advance: Number(e.advance) || 0, hireDate: e.hireDate || null,
        status: e.status === 'fired' ? 'fired' : 'active', position: i,
      }));
      if (rows.length) await this.empRepo.save(rows);
    }

    // Аренда/подписки.
    if ((await this.subRepo.count()) === 0 && Array.isArray(backup.subscriptions)) {
      const rows = backup.subscriptions.map((s: any, i: number) => this.subRepo.create({
        name: s.name, kind: s.kind === 'rent' ? 'rent' : 'subscription',
        amount: Number(s.amount) || 0, active: s.active !== false, position: i,
      }));
      if (rows.length) await this.subRepo.save(rows);
    }

    // Долги.
    if ((await this.debtRepo.count()) === 0 && Array.isArray(backup.debts)) {
      const rows = backup.debts.map((d: any, i: number) => this.debtRepo.create({
        name: d.name, counterparty: d.counterparty ?? null, totalAmount: Number(d.totalAmount) || 0,
        monthlyPayment: Number(d.monthlyPayment) || 0, paidBefore: Number(d.paidBefore) || 0,
        note: d.note ?? null, position: i,
      }));
      if (rows.length) await this.debtRepo.save(rows);
    }

    // Плановые оплаты — резолвим по имени (backup id ≠ наш uuid).
    if ((await this.ppRepo.count()) === 0 && Array.isArray(backup.plannedPayments)) {
      const clientNameById = new Map<string, string>((backup.clients || []).map((c: any) => [c.id, c.name]));
      const debtNameById = new Map<string, string>((backup.debts || []).map((d: any) => [d.id, d.name]));
      const projByName = new Map((await this.projRepo.find()).map(p => [p.name, p]));
      const debtByName = new Map((await this.debtRepo.find()).map(d => [d.name, d]));
      const rows: FinancePlannedPayment[] = [];
      for (const pp of backup.plannedPayments) {
        let projectId: string | null = null;
        let debtId: string | null = null;
        if (pp.clientId) {
          const nm = clientNameById.get(pp.clientId);
          const p = nm ? projByName.get(nm) : null;
          if (!p) continue;
          projectId = p.id;
        } else if (pp.debtId) {
          const nm = debtNameById.get(pp.debtId);
          const d = nm ? debtByName.get(nm) : null;
          if (!d) continue;
          debtId = d.id;
        } else continue;
        rows.push(this.ppRepo.create({
          projectId, debtId, ym: pp.ym, partNo: Number(pp.partNo) || 1,
          amount: Number(pp.amount) || 0, status: pp.status === 'received' ? 'received' : 'expected', auto: false,
        }));
      }
      if (rows.length) await this.ppRepo.save(rows);
    }
  }

  /** Прочитать Dexie-бэкап WebRand по нескольким возможным путям. */
  private readWebRandBackup(): any | null {
    const file = 'webrand-backup-2026-07-01.json';
    const candidates = [
      path.resolve(process.cwd(), '..', 'fin-webrand', file),
      path.resolve(process.cwd(), 'fin-webrand', file),
      path.resolve(__dirname, '..', '..', '..', '..', 'fin-webrand', file),
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'fin-webrand', file),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch { /* пропускаем */ }
    }
    // Файл на проде (Railway) отсутствует — используем встроенный снимок,
    // чтобы первичный посев работал в любом окружении.
    return WEBRAND_BACKUP ?? null;
  }

  // ─── справочники: helpers ────────────────────────────────────────
  private async maps(): Promise<FinMaps> {
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
  private directionOf(tx: FinanceTransaction, m: FinMaps): string | null {
    if (tx.projectId && m.proj.has(tx.projectId)) return m.proj.get(tx.projectId)!.direction;
    const key = tx.categoryId ? m.cat.get(tx.categoryId)?.key : null;
    if (key === 'smm' || key === 'smm1' || key === 'smm2') return 'smm';
    if (key === 'development') return 'development';
    if (key === 'design') return 'design';
    return null;
  }

  private catKey(tx: FinanceTransaction, m: FinMaps): string | null {
    return tx.categoryId ? (m.cat.get(tx.categoryId)?.key ?? null) : null;
  }

  /** Группа дашборда: доход → smm/development/design; расход → salary/rent_subs/debts. */
  private groupOf(tx: FinanceTransaction, m: FinMaps): string | null {
    if (tx.type === FinanceTxType.INCOME) return this.directionOf(tx, m);
    if (tx.type === FinanceTxType.EXPENSE) {
      const key = this.catKey(tx, m);
      if (tx.employeeId || key === 'salary') return 'salary';
      if (tx.subscriptionId || key === 'rent' || key === 'subscription') return 'rent_subs';
      if (tx.debtId || key === 'debt') return 'debts';
    }
    return null;
  }

  private active(txs: FinanceTransaction[]) {
    return txs.filter(t => t.status !== FinanceTxStatus.CANCELLED);
  }

  /** Пожизненный баланс счёта = startBalance + приходы − расходы + переводы. */
  private lifetimeBalance(a: FinanceAccount, txs: FinanceTransaction[]): number {
    let bal = Number(a.startBalance);
    for (const t of txs) {
      const amt = Number(t.amount);
      if (t.type === FinanceTxType.INCOME && t.accountId === a.id) bal += amt;
      else if (t.type === FinanceTxType.SAVING && t.accountId === a.id) bal += amt;
      else if (t.type === FinanceTxType.EXPENSE && t.accountId === a.id) bal -= amt;
      else if (t.type === FinanceTxType.TRANSFER) {
        if (t.fromAccountId === a.id) bal -= amt;
        if (t.toAccountId === a.id) bal += amt;
      }
    }
    return r2(bal);
  }

  /** Остаток по долгу = totalAmount − paidBefore − Σ погашений (расходы с debtId). */
  private debtRemaining(debt: FinanceDebt, allExp: FinanceTransaction[]): number {
    const repaid = allExp.filter(t => t.debtId === debt.id).reduce((s, t) => s + Number(t.amount), 0);
    return r2(Math.max(0, Number(debt.totalAmount) - Number(debt.paidBefore) - repaid));
  }

  private sum(arr: FinanceTransaction[]) { return r2(arr.reduce((s, t) => s + Number(t.amount), 0)); }

  // ─── ОБЗОР ───────────────────────────────────────────────────────
  async overview(ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const allTx = this.active(await this.txRepo.find());
    const monthTx = allTx.filter(t => t.date >= from && t.date <= to);
    const planned = await this.ppRepo.find();
    const subs = await this.subRepo.find();

    const monthIncome = monthTx.filter(t => t.type === FinanceTxType.INCOME);
    const monthExpense = monthTx.filter(t => t.type === FinanceTxType.EXPENSE);
    const income = this.sum(monthIncome);
    const expense = this.sum(monthExpense);

    // Балансы счетов (пожизненные).
    const balances = [...m.accounts]
      .sort((a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : 1))
      .map(a => ({
        accountId: a.id, name: a.name, color: a.color ?? null,
        kind: a.kind ?? (a.key === 'cash' ? 'cash' : 'bank'), balance: this.lifetimeBalance(a, allTx),
      }));

    // Разбивка месяца по категориям.
    const incomeByCategory = this.byCategoryList(monthIncome, m);
    const expenseByCategory = this.byCategoryList(monthExpense, m);

    // План/факт дохода по направлениям.
    const dirs = ['smm', 'development', 'design'];
    const incomePlan = dirs.map(dir => {
      const projs = m.projects.filter(p => p.direction === dir && !p.archived && p.status !== 'lead');
      const ids = new Set(projs.map(p => p.id));
      const plan = r2(projs.reduce((s, p) => s + Number(p.tariff), 0));
      const fact = r2(planned
        .filter(p => p.ym === ym && p.projectId && ids.has(p.projectId) && p.status === 'received')
        .reduce((s, p) => s + Number(p.amount), 0));
      return { direction: dir, plan, fact };
    });

    // Зарплата (бонусы месяца входят в «к выплате»).
    const activeEmps = m.employees.filter(e => e.status === 'active');
    const salaryFund = r2(activeEmps.reduce((s, e) => s + Number(e.salary), 0));
    const salaryAdvances = r2(activeEmps.reduce((s, e) => s + Number(e.advance), 0));
    const salaryBonuses = r2(activeEmps.reduce((s, e) => s + bonusOf(e, ym), 0));
    const salaryPaid = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'salary'));
    const salaryToPay = r2(Math.max(0, salaryFund + salaryBonuses - salaryAdvances - salaryPaid));

    // Аренда/подписки.
    const subsMonthly = r2(subs.filter(s => s.active).reduce((s, x) => s + Number(x.amount), 0));
    const rentSubFact = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'rent_subs'));

    // Долги.
    const totalDebt = r2(m.debts.reduce((s, d) => s + this.debtRemaining(d, allTx), 0));
    const debtPlan = r2(m.debts.reduce((s, d) => s + Math.min(Number(d.monthlyPayment), this.debtRemaining(d, allTx)), 0));
    const debtFact = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'debts'));

    const expensePlan = [
      { group: 'salary', plan: salaryToPay, fact: salaryPaid },
      { group: 'rent_subs', plan: subsMonthly, fact: rentSubFact },
      { group: 'debts', plan: debtPlan, fact: debtFact },
    ];

    const expectedIncome = r2(planned
      .filter(p => p.status === 'expected' && p.projectId)
      .reduce((s, p) => s + Number(p.amount), 0));

    const stats = { expectedIncome, salaryToPay, salaryFund, salaryAdvances, salaryBonuses, salaryPaid, totalDebt, subsMonthly };

    const transactions = await this.decorate(this.sortByDateDesc(monthTx), m);

    return {
      ym, income, expense, profit: r2(income - expense),
      balances, incomeByCategory, expenseByCategory, incomePlan, expensePlan, stats, transactions,
      // Legacy-алиасы (совместимость со старым фронтом).
      incomeByDirection: incomePlan.map(x => ({ direction: x.direction, received: x.fact, plan: x.plan })),
      expectedIncome, salaryFund, salaryPaid, salaryToPay, totalDebt, regularMonthly: subsMonthly,
    };
  }

  /** Разбивка набора операций по категориям (для дашборда), desc по сумме. */
  private byCategoryList(txs: FinanceTransaction[], m: FinMaps) {
    const map = new Map<string | null, number>();
    for (const t of txs) {
      const key = t.categoryId ?? null;
      map.set(key, (map.get(key) ?? 0) + Number(t.amount));
    }
    return [...map.entries()].map(([categoryId, total]) => {
      const c = categoryId ? m.cat.get(categoryId) : null;
      return {
        categoryId, name: c?.name ?? 'Без категории',
        icon: c?.icon ?? null, color: c?.color ?? null, total: r2(total),
      };
    }).sort((a, b) => b.total - a.total);
  }

  private sortByDateDesc(txs: FinanceTransaction[]): FinanceTransaction[] {
    return [...txs].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.createdAt?.getTime?.() ?? 0) < (b.createdAt?.getTime?.() ?? 0) ? 1 : -1;
    });
  }

  // ─── ДОХОД: направления и детализация ────────────────────────────
  async incomeDirections(ym: string) {
    const m = await this.maps();
    const planned = await this.ppRepo.find();
    const dirs = ['smm', 'development', 'design'];
    return dirs.map(dir => {
      const projs = m.projects.filter(p => p.direction === dir && !p.archived && p.status !== 'lead');
      const ids = new Set(projs.map(p => p.id));
      const forMonth = planned.filter(p => p.ym === ym && p.projectId && ids.has(p.projectId));
      const received = r2(forMonth.filter(p => p.status === 'received' && p.receivedTxId).reduce((s, p) => s + Number(p.amount), 0));
      const expected = r2(forMonth.filter(p => p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0));
      return {
        direction: dir, received,
        plan: r2(projs.reduce((s, p) => s + Number(p.tariff), 0)),
        projectCount: projs.length, expected,
      };
    });
  }

  async incomeDirectionDetail(direction: string, ym: string, start?: string) {
    const m = await this.maps();
    const planned = await this.ppRepo.find();
    const today = todayISO();

    if (direction === 'smm') {
      const projects = m.projects.filter(p => p.direction === 'smm');
      const active = projects.filter(p => !p.archived);
      const archived = projects.filter(p => p.archived);
      const rows = active.map(p => {
        const pPlans = planned.filter(x => x.projectId === p.id);
        const monthPlans = pPlans.filter(x => x.ym === ym);
        const partOf = (n: number) => {
          const x = monthPlans.find(y => y.partNo === n);
          return x ? { plannedId: x.id, amount: Number(x.amount), status: x.status, txId: x.receivedTxId, dueDate: x.dueDate ?? null } : null;
        };
        const paidLife = r2(pPlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
        // Ближайший будущий ожидаемый платёж (для «след. платёж» при полной оплате).
        const nextPlan = pPlans
          .filter(x => x.status === 'expected' && x.ym > ym)
          .sort((a, b) => ((a.dueDate ?? a.ym) < (b.dueDate ?? b.ym) ? -1 : 1))[0] ?? null;
        return {
          project: { id: p.id, name: p.name, tariff: Number(p.tariff), contractDate: p.contractDate, archived: p.archived, note: p.note },
          // Дата цикла «катится»: контракт 20.01 → в просмотре февраля 20.02.
          cycleDate: this.smmCycleDate(p, ym),
          part1: partOf(1), part2: partOf(2), paidLife,
          nextDue: nextPlan ? { ym: nextPlan.ym, amount: Number(nextPlan.amount), dueDate: nextPlan.dueDate ?? null } : null,
          fullyPaid: Number(p.tariff) > 0 && paidLife >= Number(p.tariff),
          alert: this.smmAlert(p, pPlans, today),
        };
      });
      // Свежая дата — сверху. Сортируем по отображаемой дате цикла, чтобы
      // колонка «Дата контракта» читалась упорядоченно в любом месяце.
      rows.sort((a, b) => (b.cycleDate ?? '').localeCompare(a.cycleDate ?? '')
        || a.project.name.localeCompare(b.project.name, 'ru'));
      const activeIds = new Set(active.map(p => p.id));
      const monthActive = planned.filter(x => x.projectId && activeIds.has(x.projectId) && x.ym === ym);
      const expected = r2(monthActive.filter(x => x.status === 'expected').reduce((s, x) => s + Number(x.amount), 0));
      const receivedCash = r2(monthActive.filter(x => x.status === 'received' && x.receivedTxId).reduce((s, x) => s + Number(x.amount), 0));
      const spentOffAccount = r2(monthActive.filter(x => x.status === 'received' && !x.receivedTxId).reduce((s, x) => s + Number(x.amount), 0));
      const part1 = r2(rows.reduce((s, r) => s + (r.part1?.amount ?? 0), 0));
      const part2 = r2(rows.reduce((s, r) => s + (r.part2?.amount ?? 0), 0));
      return {
        kind: 'smm', rows,
        stats: { expected, receivedCash, spentOffAccount, total: r2(expected + receivedCash) },
        totals: { tariff: r2(active.reduce((s, p) => s + Number(p.tariff), 0)), part1, part2, full: r2(part1 + part2) },
        needPay: rows.filter(r => r.alert === 'pay').length,
        needRest: rows.filter(r => r.alert === 'rest').length,
        archived: archived.map(p => ({ id: p.id, name: p.name, tariff: Number(p.tariff), contractDate: p.contractDate })),
      };
    }

    if (direction === 'development') {
      const active = m.projects.filter(p => p.direction === 'development' && !p.archived);
      const winStart = start || this.defaultStart(active, planned);
      const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));
      const { rows, totals } = this.buildMatrix(active, planned, months);
      const ids = new Set(active.map(p => p.id));
      const cm = currentYm();
      const stExpected = r2(planned.filter(x => x.projectId && ids.has(x.projectId) && x.ym === cm && x.status === 'expected').reduce((s, x) => s + Number(x.amount), 0));
      const stReceived = r2(planned.filter(x => x.projectId && ids.has(x.projectId) && x.ym === cm && x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
      return { kind: 'matrix', months, rows, totals, stats: { expected: stExpected, received: stReceived, total: totals.tariff } };
    }

    if (direction === 'design') {
      const designAll = m.projects.filter(p => p.direction === 'design' && !p.archived);
      const simpleClients = designAll.filter(p => !p.multiMonth);
      const matrixClients = designAll.filter(p => p.multiMonth);
      const winStart = start || this.defaultStart(designAll, planned);
      const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));
      const allIncome = this.active(await this.txRepo.find({ where: { type: FinanceTxType.INCOME } as any }));
      const clientPaid = (id: string) => r2(allIncome.filter(t => t.projectId === id).reduce((s, t) => s + Number(t.amount), 0));

      const simple = simpleClients.map(p => {
        const pPlans = planned.filter(x => x.projectId === p.id);
        return {
          project: { id: p.id, name: p.name, tariff: Number(p.tariff), contractDate: p.contractDate, note: p.note },
          paidLife: r2(pPlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0)),
          paid: clientPaid(p.id),
        };
      });
      const matrix = { ...this.buildMatrix(matrixClients, planned, months), months };

      const cm = currentYm();
      const { from, to } = monthRange(cm);
      const received = r2(allIncome
        .filter(t => t.date >= from && t.date <= to && this.directionOf(t, m) === 'design')
        .reduce((s, t) => s + Number(t.amount), 0));
      const mIds = new Set(matrixClients.map(p => p.id));
      const expectedMatrix = r2(planned.filter(x => x.projectId && mIds.has(x.projectId) && x.ym === cm && x.status === 'expected').reduce((s, x) => s + Number(x.amount), 0));
      const expectedSimple = r2(simpleClients
        .filter(p => p.contractDate && ymOf(p.contractDate) === cm)
        .reduce((s, p) => s + Math.max(0, Number(p.tariff) - clientPaid(p.id)), 0));
      const total = r2(designAll.reduce((s, p) => s + Number(p.tariff), 0));
      return { kind: 'design', months, simple, matrix, stats: { expected: r2(expectedMatrix + expectedSimple), received, total } };
    }

    throw new BadRequestException('Неизвестное направление');
  }

  /** Дата цикла в просматриваемом месяце: день якоря (последней полной
   *  оплаты, иначе контракта), спроецированный в ym. В месяце самого якоря —
   *  его точная дата. */
  private smmCycleDate(p: FinanceProject, ym: string): string | null {
    const anchor = smmAnchor(p);
    const day = contractDay(anchor);
    if (!anchor || day === null) return anchor ?? null;
    return ymOf(anchor) === ym ? anchor : dueDateForMonth(ym, day);
  }

  /** Напоминание по циклу оплаты SMM: 'pay' | 'rest' | null.
   *  Основной сигнал — просроченные expected-планы (авто-план следующего
   *  цикла и остатки создаются самой системой), поэтому подсветка согласована
   *  с бейджами сроков в таблице. Календарный фолбэк — для проектов без
   *  планов (заведены до автологики). */
  private smmAlert(p: FinanceProject, pPlans: FinancePlannedPayment[], today: string): 'pay' | 'rest' | null {
    if (Number(p.tariff) <= 0) return null;
    const anchor = smmAnchor(p);
    const day = contractDay(anchor);
    if (!anchor || day === null) return null;

    const overdue = pPlans.filter(x => x.status === 'expected' && x.dueDate && x.dueDate <= today);
    if (overdue.length) {
      // Просрочен остаток уже начатого цикла → «получить остаток».
      const isRest = overdue.some(o => pPlans.some(r => r.ym === o.ym && r.status === 'received'));
      return isRest ? 'rest' : 'pay';
    }
    if (pPlans.some(x => x.status === 'expected' && x.dueDate)) return null; // срок ещё впереди

    // Фолбэк: календарный срок по дню якоря в текущем/прошлом месяце.
    const todayYm = ymOf(today);
    let due = dueDateForMonth(todayYm, day);
    if (due > today) due = dueDateForMonth(shiftYm(todayYm, -1), day);
    // Срок не позже даты последней полной оплаты — цикл покрыт ею.
    if (p.cycleAnchor && due <= p.cycleAnchor) return null;
    // До начала контракта долгов нет.
    if (!p.cycleAnchor && p.contractDate && due < p.contractDate) return null;
    const recv = pPlans.filter(x => x.ym === ymOf(due) && x.status === 'received').reduce((s, x) => s + Number(x.amount), 0);
    if (recv >= Number(p.tariff) - 0.005) return null;
    if (recv <= 0) return 'pay';
    const daysIn = Math.floor((new Date(today).getTime() - new Date(due).getTime()) / 86400000);
    return daysIn >= 24 ? 'rest' : null;
  }

  /** Старт окна матрицы = самый ранний из дат контракта / плановых оплат / текущего месяца. */
  private defaultStart(projs: FinanceProject[], planned: FinancePlannedPayment[]): string {
    const ids = new Set(projs.map(p => p.id));
    const ms = [
      ...projs.map(p => (p.contractDate ? p.contractDate.slice(0, 7) : null)).filter(Boolean) as string[],
      ...planned.filter(p => p.projectId && ids.has(p.projectId)).map(p => p.ym),
      currentYm(),
    ].sort();
    return ms[0] ?? currentYm();
  }

  private defaultStartDebts(debts: FinanceDebt[], planned: FinancePlannedPayment[]): string {
    const ids = new Set(debts.map(d => d.id));
    const ms = [
      ...planned.filter(p => p.debtId && ids.has(p.debtId)).map(p => p.ym),
      currentYm(),
    ].sort();
    return ms[0] ?? currentYm();
  }

  /** Матрица «проект × месяц»: строки с ячейками и итоги по месяцам. */
  private buildMatrix(clients: FinanceProject[], planned: FinancePlannedPayment[], months: string[]) {
    const ids = new Set(clients.map(c => c.id));
    const rows = clients.map(p => {
      const pPlans = planned.filter(x => x.projectId === p.id);
      const paidLife = r2(pPlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
      const scheduledLife = r2(pPlans.reduce((s, x) => s + Number(x.amount), 0));
      const cells = months.map(mm => {
        const cp = pPlans.filter(x => x.ym === mm);
        return {
          ym: mm,
          plans: cp.map(x => ({ id: x.id, amount: Number(x.amount), status: x.status, txId: x.receivedTxId })),
          received: r2(cp.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0)),
          expected: r2(cp.filter(x => x.status === 'expected').reduce((s, x) => s + Number(x.amount), 0)),
        };
      });
      return { project: { id: p.id, name: p.name, tariff: Number(p.tariff), note: p.note, multiMonth: p.multiMonth }, paidLife, scheduledLife, cells };
    });
    const totals = {
      tariff: r2(clients.reduce((s, p) => s + Number(p.tariff), 0)),
      perMonth: months.map(mm => ({
        ym: mm,
        total: r2(planned.filter(x => x.ym === mm && x.projectId && ids.has(x.projectId)).reduce((s, x) => s + Number(x.amount), 0)),
      })),
    };
    return { rows, totals };
  }

  // ─── РАСХОД: сводка и детализация ────────────────────────────────
  async expenseSummary(ym: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthExp = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.EXPENSE } as any }));
    const allExp = this.active(await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE } as any }));
    const subs = await this.subRepo.find();
    const planned = await this.ppRepo.find();

    const activeEmps = m.employees.filter(e => e.status === 'active');
    const salaryFund = r2(activeEmps.reduce((s, e) => s + Number(e.salary), 0));
    const salaryAdvances = r2(activeEmps.reduce((s, e) => s + Number(e.advance), 0));
    const salaryBonuses = r2(activeEmps.reduce((s, e) => s + bonusOf(e, ym), 0));
    const salarySpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'salary'));
    // Сотрудники, у которых месяц закрыт (выплачено ≥ оклад + бонус) — для подсветки карточки.
    const salaryPaidCount = activeEmps.filter(e => {
      const due = r2(Number(e.salary) + bonusOf(e, ym));
      if (due <= 0) return false;
      const paid = monthExp.filter(t => t.employeeId === e.id).reduce((s, t) => s + Number(t.amount), 0);
      // Полкопейки допуска — сумма float'ов может недотянуть до r2-округлённого due.
      return paid >= due - 0.005;
    }).length;

    const activeSubs = subs.filter(s => s.active);
    const subsCount = activeSubs.length;
    const subMonthly = r2(activeSubs.reduce((s, x) => s + Number(x.amount), 0));
    const subsSpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'rent_subs'));
    // Позиции, оплаченные за месяц: операцией журнала или отметкой без операции.
    const subsPaidCount = activeSubs.filter(s =>
      monthExp.some(t => t.subscriptionId === s.id) || (s.paidMarks || []).some(x => x.ym === ym),
    ).length;

    const debtIds = new Set(m.debts.map(d => d.id));
    const cm = currentYm();
    const debtsSpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'debts'));
    const totalRemaining = r2(m.debts.reduce((s, d) => s + this.debtRemaining(d, allExp), 0));
    const dueMonth = r2(planned.filter(p => p.debtId && debtIds.has(p.debtId) && p.ym === cm && p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0));
    // Месячное обязательство по долгам — как в эталоне (карточка «Долги» на
    // странице Расход и план/факт Обзора): Σ min(платёж/мес, остаток).
    const debtsMonthly = r2(m.debts.reduce((s, d) => s + Math.min(Number(d.monthlyPayment) || 0, this.debtRemaining(d, allExp)), 0));
    const debtCount = m.debts.filter(d => this.debtRemaining(d, allExp) > 0).length;

    const otherSpent = this.sum(monthExp.filter(t => !['salary', 'rent_subs', 'debts'].includes(this.groupOf(t, m) || '')));

    return {
      ym,
      salary: { spent: salarySpent, count: activeEmps.length, paidCount: salaryPaidCount, bonuses: salaryBonuses, toPay: r2(Math.max(0, salaryFund + salaryBonuses - salaryAdvances - salarySpent)) },
      subscriptions: { spent: subsSpent, count: subsCount, paidCount: subsPaidCount, monthly: subMonthly },
      debts: { spent: debtsSpent, count: debtCount, remaining: totalRemaining, dueMonth, monthly: debtsMonthly },
      other: { spent: otherSpent },
    };
  }

  async expenseDetail(kind: string, ym: string, start?: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const monthExp = this.active(await this.txRepo.find({ where: { date: Between(from, to), type: FinanceTxType.EXPENSE } as any }));

    if (kind === 'salary') {
      const emps = await this.empRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
      const paidOf = (id: string) => r2(monthExp.filter(t => t.employeeId === id).reduce((s, t) => s + Number(t.amount), 0));
      const activeEmps = emps.filter(e => e.status === 'active');
      const rows = activeEmps.map(e => {
        const paid = paidOf(e.id);
        const bonus = bonusOf(e, ym);
        return {
          id: e.id, name: e.name, role: e.role, hireDate: e.hireDate, salary: Number(e.salary),
          advance: Number(e.advance), bonus, status: e.status, paid,
          toPay: r2(Math.max(0, Number(e.salary) + bonus - paid)),
        };
      });
      const fund = r2(activeEmps.reduce((s, e) => s + Number(e.salary), 0));
      const advances = r2(activeEmps.reduce((s, e) => s + Number(e.advance), 0));
      const bonuses = r2(activeEmps.reduce((s, e) => s + bonusOf(e, ym), 0));
      const paid = r2(activeEmps.reduce((s, e) => s + paidOf(e.id), 0));
      return {
        kind: 'salary',
        cards: { fund, advances, bonuses, paid, toPay: r2(Math.max(0, fund + bonuses - advances - paid)) },
        rows,
        fired: emps.filter(e => e.status !== 'active').map(e => ({ id: e.id, name: e.name, role: e.role, salary: Number(e.salary) })),
      };
    }

    if (kind === 'subscriptions') {
      const subs = await this.subRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
      const rows = subs.map(s => {
        const txs = monthExp.filter(t => t.subscriptionId === s.id);
        const dates = txs.map(t => t.date).sort();
        // Отметка «оплачено без операции» за выбранный месяц (денег не двигает).
        const mark = (s.paidMarks || []).find(x => x.ym === ym) ?? null;
        return {
          id: s.id, name: s.name, kind: s.kind, amount: Number(s.amount), active: s.active,
          paidMonth: this.sum(txs), lastPaidDate: dates.length ? dates[dates.length - 1] : null,
          paidMark: mark ? mark.date : null,
        };
      });
      return { kind: 'subscriptions', rows, monthly: r2(subs.filter(s => s.active).reduce((s, x) => s + Number(x.amount), 0)) };
    }

    if (kind === 'debts') {
      const debts = await this.debtRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
      const allExp = this.active(await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE } as any }));
      const planned = await this.ppRepo.find();
      const winStart = start || this.defaultStartDebts(debts, planned);
      const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));
      const ids = new Set(debts.map(d => d.id));
      const rows = debts.map(d => {
        const remaining = this.debtRemaining(d, allExp);
        const total = Number(d.totalAmount);
        const cells = months.map(mm => {
          const cp = planned.filter(p => p.debtId === d.id && p.ym === mm);
          return { ym: mm, plans: cp.map(p => ({ id: p.id, amount: Number(p.amount), status: p.status, txId: p.receivedTxId })) };
        });
        return {
          debt: { id: d.id, name: d.name, totalAmount: total, monthlyPayment: Number(d.monthlyPayment), counterparty: d.counterparty },
          remaining, progress: total > 0 ? r2(((total - remaining) / total) * 100) : 0, cells,
        };
      });
      const totals = {
        total: r2(debts.reduce((s, d) => s + Number(d.totalAmount), 0)),
        perMonth: months.map(mm => ({ ym: mm, total: r2(planned.filter(p => p.debtId && ids.has(p.debtId) && p.ym === mm).reduce((s, p) => s + Number(p.amount), 0)) })),
      };
      const cm = currentYm();
      return {
        kind: 'debts', months, rows, totals,
        stats: {
          totalDebt: r2(debts.reduce((s, d) => s + this.debtRemaining(d, allExp), 0)),
          dueMonth: r2(planned.filter(p => p.debtId && ids.has(p.debtId) && p.ym === cm && p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0)),
          count: debts.filter(d => this.debtRemaining(d, allExp) > 0).length,
        },
      };
    }

    // other
    const other = monthExp.filter(t => !['salary', 'rent_subs', 'debts'].includes(this.groupOf(t, m) || ''));
    const total = this.sum(other);
    const map = new Map<string | null, number>();
    for (const t of other) { const k = t.categoryId ?? null; map.set(k, (map.get(k) ?? 0) + Number(t.amount)); }
    const rows = [...map.entries()].map(([categoryId, tot]) => {
      const c = categoryId ? m.cat.get(categoryId) : null;
      return {
        categoryId, name: c?.name ?? 'Без категории', icon: c?.icon ?? null, color: c?.color ?? null,
        total: r2(tot), share: total > 0 ? Math.round((tot / total) * 100) : 0,
      };
    }).sort((a, b) => b.total - a.total);
    return { kind: 'other', rows, total };
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
  private async decorate(txs: FinanceTransaction[], m: FinMaps) {
    return txs.map(t => {
      const cat = t.categoryId ? m.cat.get(t.categoryId) : null;
      return {
        id: t.id, date: t.date, type: t.type, amount: Number(t.amount), status: t.status, comment: t.comment,
        categoryId: t.categoryId, categoryName: cat?.name ?? (t.category ?? null),
        categoryIcon: cat?.icon ?? null, categoryColor: cat?.color ?? null,
        group: this.groupOf(t, m),
        projectId: t.projectId, projectName: t.projectId ? m.proj.get(t.projectId)?.name ?? null : null,
        employeeId: t.employeeId, employeeName: t.employeeId ? m.emp.get(t.employeeId)?.name ?? null : null,
        debtId: t.debtId, debtName: t.debtId ? m.debt.get(t.debtId)?.name ?? null : null,
        subscriptionId: t.subscriptionId,
        accountId: t.accountId, accountName: t.accountId ? m.acc.get(t.accountId)?.name ?? null : null,
        fromAccountId: t.fromAccountId, fromAccountName: t.fromAccountId ? m.acc.get(t.fromAccountId)?.name ?? null : null,
        toAccountId: t.toAccountId, toAccountName: t.toAccountId ? m.acc.get(t.toAccountId)?.name ?? null : null,
      };
    });
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
    const pageSize = Math.min(100000, Math.max(1, f.pageSize ?? 100));
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
    const date = dto.date || todayISO();

    const base: Partial<FinanceTransaction> = {
      type, amount, date, comment: dto.comment ?? null, createdById,
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
      if (type === FinanceTxType.EXPENSE) {
        base.employeeId = dto.employeeId ?? null;
        base.debtId = dto.debtId ?? null;
        base.subscriptionId = dto.subscriptionId ?? null;
      }
    }
    const saved = await this.txRepo.save(this.txRepo.create(base));
    await this.syncSmmPartLink(saved.id);
    return saved;
  }

  async updateTransaction(id: string, dto: any) {
    const t = await this.txRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Операция не найдена');
    if (dto.amount != null) {
      const a = Number(dto.amount);
      if (!Number.isFinite(a) || a <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    }
    const patch: any = {};
    for (const k of ['amount', 'date', 'comment', 'categoryId', 'accountId', 'fromAccountId', 'toAccountId', 'projectId', 'employeeId', 'debtId', 'subscriptionId', 'type']) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    // Смена типа чистит неприменимые поля (§5.11): income/expense/saving не имеют
    // from/to; transfer не имеет счёта-получателя/категории/привязок. Иначе после
    // transfer→income остаются старые from/to и операция выпадает из балансов.
    if (patch.type !== undefined && patch.type !== t.type) {
      if (patch.type === FinanceTxType.TRANSFER) {
        patch.accountId = patch.accountId ?? null;
        patch.categoryId = patch.categoryId ?? null;
        patch.projectId = null; patch.employeeId = null; patch.debtId = null; patch.subscriptionId = null;
      } else {
        patch.fromAccountId = null; patch.toAccountId = null;
        if (patch.type !== FinanceTxType.INCOME) patch.projectId = patch.projectId ?? null;
        if (patch.type !== FinanceTxType.EXPENSE) { patch.employeeId = null; patch.debtId = null; patch.subscriptionId = null; }
      }
    }
    if (patch.categoryId !== undefined) patch.category = patch.categoryId ? (await this.catRepo.findOne({ where: { id: patch.categoryId } }))?.name ?? null : null;
    await this.txRepo.update(id, patch);
    await this.syncSmmPartLink(id);
    return this.txRepo.findOne({ where: { id } });
  }

  async removeTransaction(id: string) {
    const tx = await this.txRepo.findOne({ where: { id } });
    // Плановые оплаты, связанные с этой операцией: авто — удалить, ручные — вернуть в «ожидается».
    const linked = await this.ppRepo.find({ where: { receivedTxId: id } });
    for (const p of linked) {
      if (p.auto) await this.ppRepo.delete(p.id);
      else { p.status = 'expected'; p.receivedTxId = null; await this.ppRepo.save(p); }
    }
    await this.txRepo.delete(id);
    // Удалённая оплата могла быть той, что двигала якорь SMM-цикла.
    const projectId = tx?.projectId ?? linked.find(x => x.projectId)?.projectId ?? null;
    if (projectId) await this.resyncSmmAfterUndo(projectId);
    return { ok: true };
  }

  /** Синхронизирует авто-плановую оплату SMM (часть 1/2) с операцией журнала,
   *  чтобы она отображалась в таблице SMM (категория smm1/smm2 + проект). */
  private async syncSmmPartLink(txId: string) {
    const tx = await this.txRepo.findOne({ where: { id: txId } });
    const existing = await this.ppRepo.findOne({ where: { auto: true, receivedTxId: txId } });
    const key = tx?.categoryId ? (await this.catRepo.findOne({ where: { id: tx.categoryId } }))?.key ?? null : null;
    const partNo = key === 'smm2' ? 2 : key === 'smm1' ? 1 : null;
    const shouldExist = !!(tx && tx.type === FinanceTxType.INCOME && tx.projectId && partNo);

    if (shouldExist && tx && partNo) {
      const data = {
        projectId: tx.projectId, ym: tx.date.slice(0, 7), partNo, amount: Number(tx.amount),
        status: 'received' as const, receivedTxId: txId, auto: true,
      };
      if (existing) await this.ppRepo.update(existing.id, data);
      else await this.ppRepo.save(this.ppRepo.create(data));
      await this.ensureSmmFollowUps(tx.projectId);
    } else if (existing) {
      await this.ppRepo.delete(existing.id);
    }
  }

  /** Автологика цикла оплат SMM. После получения оплаты:
   *  — если тариф цикла покрыт не полностью — создаёт ожидаемую часть 2 на
   *    остаток со сроком «дата оплаты части 1 + 20 дней»;
   *  — если цикл оплачен полностью — создаёт ожидаемый платёж следующего
   *    цикла ко дню контракта и уведомляет финансовых пользователей.
   *  Ничего не создаёт, если план на месяц/следующий месяц уже есть. */
  private async ensureSmmFollowUps(projectId?: string | null) {
    if (!projectId) return;
    try {
      const p = await this.projRepo.findOne({ where: { id: projectId } });
      const tariff = Number(p?.tariff) || 0;
      if (!p || p.direction !== 'smm' || p.archived || tariff <= 0) return;

      const plans = await this.ppRepo.find({ where: { projectId } });
      const received = plans.filter(x => x.status === 'received');
      if (!received.length) return;
      // Якорь всегда актуализируем: сюда попадают и правки транзакций
      // (syncSmmPartLink), меняющие даты/суммы уже полученных оплат.
      await this.recomputeSmmAnchor(p, plans);
      // Текущий цикл = месяц последней полученной оплаты.
      const yms = received.map(x => x.ym).sort();
      const lastYm = yms[yms.length - 1];
      const cycleReceived = r2(received.filter(x => x.ym === lastYm).reduce((s, x) => s + Number(x.amount), 0));
      const monthPlans = plans.filter(x => x.ym === lastYm);

      if (cycleReceived < tariff - 0.005) {
        // Остаток не покрыт: нужна ожидаемая часть 2 (не дублируем ручные планы).
        if (monthPlans.some(x => x.partNo === 2 || x.status === 'expected')) return;
        const lastPart = received.filter(x => x.ym === lastYm).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).pop();
        const lastTx = lastPart?.receivedTxId
          ? await this.txRepo.findOne({ where: { id: lastPart.receivedTxId } })
          : null;
        const baseDate = lastTx?.date || todayISO();
        await this.ppRepo.save(this.ppRepo.create({
          projectId, ym: lastYm, partNo: 2, amount: r2(tariff - cycleReceived),
          status: 'expected', dueDate: addDays(baseDate, PART2_DUE_DAYS), auto: true,
        }));
      } else {
        // Цикл покрыт. Якорь = дата платежа, закрывшего последний цикл:
        // просрочка сдвигает следующий срок, отмена оплаты откатывает якорь
        // (recomputeSmmAnchor детерминированно выводит его из оплат).
        const anchor = smmAnchor(p);
        const day = contractDay(anchor) ?? 1;

        // Следующий цикл — через месяц от max(последний покрытый цикл, месяц
        // якоря): досрочная оплата, датированная предыдущим месяцем, не должна
        // коллизировать с только что оплаченным планом (иначе цепочка авто-
        // планирования молча обрывалась).
        const anchorYm = anchor ? ymOf(anchor) : lastYm;
        const baseYm = anchorYm > lastYm ? anchorYm : lastYm;
        const nextYm = shiftYm(baseYm, 1);
        const existingNext = plans.find(x => x.ym === nextYm);
        if (existingNext) {
          // План уже есть (создан до сдвига якоря) — подтягиваем срок.
          if (existingNext.status === 'expected') {
            existingNext.dueDate = dueDateForMonth(nextYm, day);
            await this.ppRepo.save(existingNext);
          }
          return;
        }
        const next = await this.ppRepo.save(this.ppRepo.create({
          projectId, ym: nextYm, partNo: 1, amount: tariff,
          status: 'expected', dueDate: dueDateForMonth(nextYm, day), auto: true,
        }));
        await this.scheduler.notifyCycleCompleted(p, next);
      }
    } catch (e: any) {
      this.logger.warn(`smm follow-up skipped: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Пересчитать якорь цикла из фактических оплат: дата транзакции платежа,
   *  которым последний покрытый цикл достиг тарифа. Кумулятив считается в
   *  порядке дат транзакций — ввод задним числом и доплаты после закрытия
   *  цикла якорь не двигают. Платёж без транзакции (вне счёта) в сумме
   *  участвует, но дату не задаёт — для него берётся день цикла по договору,
   *  а не «сегодня». Сохраняет проект, если якорь изменился. */
  private async recomputeSmmAnchor(p: FinanceProject, plans: FinancePlannedPayment[]): Promise<void> {
    const tariff = Number(p.tariff) || 0;
    let anchor: string | null = null;
    if (tariff > 0) {
      const received = plans.filter(x => x.status === 'received');
      const byYm = new Map<string, FinancePlannedPayment[]>();
      for (const x of received) {
        if (!byYm.has(x.ym)) byYm.set(x.ym, []);
        byYm.get(x.ym)!.push(x);
      }
      const coveredYms = [...byYm.keys()]
        .filter(ym => byYm.get(ym)!.reduce((s, x) => s + Number(x.amount), 0) >= tariff - 0.005)
        .sort();
      const lastYm = coveredYms[coveredYms.length - 1];
      if (lastYm) {
        const fallbackDate = dueDateForMonth(lastYm, contractDay(p.contractDate) ?? 1);
        const parts: Array<{ date: string; amount: number; created: number }> = [];
        for (const x of byYm.get(lastYm)!) {
          const tx = x.receivedTxId ? await this.txRepo.findOne({ where: { id: x.receivedTxId } }) : null;
          parts.push({ date: tx?.date || fallbackDate, amount: Number(x.amount), created: x.createdAt?.getTime?.() ?? 0 });
        }
        parts.sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
        let acc = 0;
        for (const part of parts) {
          acc += part.amount;
          if (acc >= tariff - 0.005) { anchor = part.date; break; }
        }
      }
    }
    if ((p.cycleAnchor ?? null) !== anchor) {
      p.cycleAnchor = anchor;
      await this.projRepo.save(p);
    }
  }

  /** После отмены/удаления оплаты SMM: пересчитать якорь и удалить осиротевшие
   *  авто-планы будущих циклов, созданные уже отменённой полной оплатой —
   *  иначе фантомный expected-план навсегда глушит авто-планирование. */
  private async resyncSmmAfterUndo(projectId?: string | null) {
    if (!projectId) return;
    try {
      const p = await this.projRepo.findOne({ where: { id: projectId } });
      if (!p || p.direction !== 'smm') return;
      const plans = await this.ppRepo.find({ where: { projectId } });
      await this.recomputeSmmAnchor(p, plans);
      const tariff = Number(p.tariff) || 0;
      if (tariff <= 0) return;

      const sums = new Map<string, number>();
      for (const x of plans.filter(y => y.status === 'received')) {
        sums.set(x.ym, (sums.get(x.ym) ?? 0) + Number(x.amount));
      }
      const coveredYms = [...sums.entries()].filter(([, s]) => s >= tariff - 0.005).map(([ym]) => ym).sort();
      const lastCovered = coveredYms[coveredYms.length - 1] ?? null;
      // Авто-план уместен в месяце имеющихся оплат (остаток, часть 2) или в
      // месяце следующего цикла. Авто-expected в любом другом месяце — сирота.
      const validYms = new Set<string>(sums.keys());
      if (lastCovered) validYms.add(shiftYm(lastCovered, 1));
      const orphans = plans.filter(x => x.auto && x.status === 'expected' && !validYms.has(x.ym));
      if (orphans.length) await this.ppRepo.delete(orphans.map(x => x.id));
    } catch (e: any) {
      this.logger.warn(`smm undo resync skipped: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  // ─── ПЛАНОВЫЕ ОПЛАТЫ ─────────────────────────────────────────────
  async listPlannedPayments(f: { projectId?: string; debtId?: string; ym?: string } = {}) {
    const where: any = {};
    if (f.projectId) where.projectId = f.projectId;
    if (f.debtId) where.debtId = f.debtId;
    if (f.ym) where.ym = f.ym;
    const rows = await this.ppRepo.find({ where, order: { ym: 'ASC', partNo: 'ASC' } });
    return rows.map(p => ({ ...p, amount: Number(p.amount) }));
  }

  async createPlannedPayment(dto: any) {
    if (!dto.projectId && !dto.debtId) throw new BadRequestException('Укажите проект или долг');
    if (dto.projectId && dto.debtId) throw new BadRequestException('Оплата относится либо к проекту, либо к долгу');
    if (!dto.ym) throw new BadRequestException('Укажите месяц');
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    return this.ppRepo.save(this.ppRepo.create({
      projectId: dto.projectId ?? null, debtId: dto.debtId ?? null, ym: dto.ym,
      partNo: Number(dto.partNo) || 1, amount, status: 'expected', auto: false,
      dueDate: dto.dueDate ?? null,
    }));
  }

  /** Создать связанную операцию под плановую оплату (доход для проекта / расход для долга). */
  private async buildLinkedTx(
    em: EntityManager, pp: { projectId?: string | null; debtId?: string | null; amount: number },
    accountId: string, date: string, comment?: string,
  ): Promise<FinanceTransaction> {
    const txRepo = em.getRepository(FinanceTransaction);
    const catRepo = em.getRepository(FinanceCategory);
    if (pp.projectId) {
      const project = await em.getRepository(FinanceProject).findOne({ where: { id: pp.projectId } });
      const key = DIRECTION_CATEGORY_KEY[project?.direction ?? 'smm'] ?? 'smm';
      const cat = await catRepo.findOne({ where: { key } });
      return txRepo.save(txRepo.create({
        type: FinanceTxType.INCOME, amount: Number(pp.amount), date, accountId,
        projectId: pp.projectId, categoryId: cat?.id ?? null, category: cat?.name ?? null,
        comment: comment ?? 'Оплата проекта', status: FinanceTxStatus.COMPLETED,
      }));
    }
    const cat = await catRepo.findOne({ where: { key: 'debt' } });
    return txRepo.save(txRepo.create({
      type: FinanceTxType.EXPENSE, amount: Number(pp.amount), date, accountId,
      debtId: pp.debtId, categoryId: cat?.id ?? null, category: cat?.name ?? null,
      comment: comment ?? 'Погашение долга', status: FinanceTxStatus.COMPLETED,
    }));
  }

  async receivePlannedPayment(id: string, dto: any) {
    if (!dto.accountId) throw new BadRequestException('Укажите счёт');
    const date = dto.date || todayISO();
    return this.ds.transaction(async (em) => {
      const ppRepo = em.getRepository(FinancePlannedPayment);
      const pp = await ppRepo.findOne({ where: { id } });
      if (!pp) throw new NotFoundException('Плановая оплата не найдена');
      if (pp.status === 'received') throw new BadRequestException('Оплата уже получена');
      const tx = await this.buildLinkedTx(em, pp, dto.accountId, date);
      pp.status = 'received';
      pp.receivedTxId = tx.id;
      await ppRepo.save(pp);
      return { ...pp, amount: Number(pp.amount) };
    }).then(async (res) => {
      // После коммита: автологика частей/цикла SMM (часть 2, следующий цикл).
      if (res.projectId) await this.ensureSmmFollowUps(res.projectId);
      return res;
    });
  }

  async unreceivePlannedPayment(id: string) {
    return this.ds.transaction(async (em) => {
      const ppRepo = em.getRepository(FinancePlannedPayment);
      const pp = await ppRepo.findOne({ where: { id } });
      if (!pp) throw new NotFoundException('Плановая оплата не найдена');
      if (pp.receivedTxId) await em.getRepository(FinanceTransaction).delete(pp.receivedTxId);
      pp.status = 'expected';
      pp.receivedTxId = null;
      await ppRepo.save(pp);
      return { ...pp, amount: Number(pp.amount) };
    }).then(async (res) => {
      // Откат оплаты: якорь и авто-планы пересчитываются из оставшихся оплат.
      if (res.projectId) await this.resyncSmmAfterUndo(res.projectId);
      return res;
    });
  }

  async removePlannedPayment(id: string) {
    return this.ds.transaction(async (em) => {
      const ppRepo = em.getRepository(FinancePlannedPayment);
      const pp = await ppRepo.findOne({ where: { id } });
      if (!pp) throw new NotFoundException('Плановая оплата не найдена');
      if (pp.receivedTxId) await em.getRepository(FinanceTransaction).delete(pp.receivedTxId);
      await ppRepo.delete(id);
      return { ok: true, projectId: pp.projectId ?? null };
    }).then(async (res) => {
      if (res.projectId) await this.resyncSmmAfterUndo(res.projectId);
      return { ok: true };
    });
  }

  /** Оплатить сразу: связанная операция + плановая оплата (received, auto=false). */
  async payNow(dto: any) {
    if (!dto.projectId && !dto.debtId) throw new BadRequestException('Укажите проект или долг');
    if (dto.projectId && dto.debtId) throw new BadRequestException('Оплата относится либо к проекту, либо к долгу');
    if (!dto.accountId) throw new BadRequestException('Укажите счёт');
    if (!dto.ym) throw new BadRequestException('Укажите месяц');
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    const date = dto.date || todayISO();
    return this.ds.transaction(async (em) => {
      const tx = await this.buildLinkedTx(em, { projectId: dto.projectId ?? null, debtId: dto.debtId ?? null, amount }, dto.accountId, date, dto.comment);
      const pp = em.getRepository(FinancePlannedPayment).create({
        projectId: dto.projectId ?? null, debtId: dto.debtId ?? null, ym: dto.ym,
        partNo: Number(dto.partNo) || 1, amount, status: 'received', receivedTxId: tx.id, auto: false,
      });
      const saved = await em.getRepository(FinancePlannedPayment).save(pp);
      return { ...saved, amount: Number(saved.amount) };
    }).then(async (res) => {
      if (res.projectId) await this.ensureSmmFollowUps(res.projectId);
      return res;
    });
  }

  // ─── ГРАФИК ДОЛГОВ ───────────────────────────────────────────────
  /** Авто-распределить остаток долга по месяцам от текущего месяца. Оплаченные
   *  платежи сохраняются, ожидаемые — перегенерируются. */
  private async regenerateDebtSchedule(debtId: string) {
    const debt = await this.debtRepo.findOne({ where: { id: debtId } });
    if (!debt) return;
    const monthly = Number(debt.monthlyPayment) || 0;
    const plans = await this.ppRepo.find({ where: { debtId } });
    const expectedIds = plans.filter(p => p.status === 'expected').map(p => p.id);
    if (expectedIds.length) await this.ppRepo.delete(expectedIds);
    if (monthly <= 0) return;

    const received = plans.filter(p => p.status === 'received');
    const receivedSum = received.reduce((s, p) => s + Number(p.amount), 0);
    const receivedMonths = new Set(received.map(p => p.ym));
    let remaining = r2(Math.max(0, Number(debt.totalAmount) - Number(debt.paidBefore) - receivedSum));

    const news: FinancePlannedPayment[] = [];
    let ym = currentYm();
    let guard = 0;
    while (remaining > 0 && guard < 240) {
      guard++;
      if (!receivedMonths.has(ym)) {
        const amount = r2(Math.min(monthly, remaining));
        news.push(this.ppRepo.create({ debtId, ym, partNo: 1, amount, status: 'expected', auto: false }));
        remaining = r2(remaining - amount);
      }
      ym = shiftYm(ym, 1);
    }
    if (news.length) await this.ppRepo.save(news);
  }

  async regenerateDebtScheduleById(debtId: string) {
    const debt = await this.debtRepo.findOne({ where: { id: debtId } });
    if (!debt) throw new NotFoundException('Долг не найден');
    await this.regenerateDebtSchedule(debtId);
    return { ok: true };
  }

  // ─── CRUD справочников ───────────────────────────────────────────
  // Счета
  listAccounts() { return this.accRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  async createAccount(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = (await this.accRepo.count());
    return this.accRepo.save(this.accRepo.create({
      name: dto.name.trim(), startBalance: Number(dto.startBalance) || 0,
      color: dto.color ?? null, kind: dto.kind ?? null, position,
    }));
  }
  async updateAccount(id: string, dto: any) {
    const a = await this.accRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Счёт не найден');
    if (dto.name !== undefined) a.name = String(dto.name).trim();
    if (dto.startBalance !== undefined) a.startBalance = Number(dto.startBalance) || 0;
    if (dto.color !== undefined) a.color = dto.color ?? null;
    if (dto.kind !== undefined) a.kind = dto.kind ?? null;
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
    const type = ['income', 'expense', 'saving', 'transfer'].includes(dto.type) ? dto.type : 'expense';
    const position = (await this.catRepo.count()) + 100;
    return this.catRepo.save(this.catRepo.create({
      name: dto.name.trim(), type, key: null, builtin: false,
      icon: dto.icon ?? 'dots', color: dto.color ?? '#64748b', position,
    }));
  }
  async updateCategory(id: string, dto: any) {
    const c = await this.catRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Категория не найдена');
    if (dto.name !== undefined) c.name = String(dto.name).trim();
    if (dto.type !== undefined && !c.builtin && ['income', 'expense', 'saving', 'transfer'].includes(dto.type)) c.type = dto.type;
    if (dto.icon !== undefined) c.icon = dto.icon;
    if (dto.color !== undefined) c.color = dto.color;
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
    const status = ['lead', 'active', 'done', 'archived'].includes(dto.status) ? dto.status : 'active';
    const position = await this.projRepo.count();
    return this.projRepo.save(this.projRepo.create({
      name: dto.name.trim(), direction, tariff: Number(dto.tariff) || 0, note: dto.note ?? null,
      contractDate: dto.contractDate ?? null, archived: !!dto.archived, multiMonth: !!dto.multiMonth,
      status, position,
    }));
  }
  async updateProject(id: string, dto: any) {
    const p = await this.projRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Проект не найден');
    if (dto.name !== undefined) p.name = String(dto.name).trim();
    if (dto.direction !== undefined && ['smm', 'development', 'design'].includes(dto.direction)) p.direction = dto.direction;
    if (dto.tariff !== undefined) p.tariff = Number(dto.tariff) || 0;
    if (dto.note !== undefined) p.note = dto.note;
    if (dto.contractDate !== undefined) {
      // Ручная правка даты контракта задаёт новую точку отсчёта цикла —
      // катящийся якорь сбрасывается и заново выставится ближайшей оплатой.
      p.contractDate = dto.contractDate || null;
      p.cycleAnchor = null;
    }
    if (dto.archived !== undefined) p.archived = !!dto.archived;
    if (dto.multiMonth !== undefined) p.multiMonth = !!dto.multiMonth;
    if (dto.status !== undefined && ['lead', 'active', 'done', 'archived'].includes(dto.status)) p.status = dto.status;
    return this.projRepo.save(p);
  }
  async removeProject(id: string) {
    const incomeTxs = await this.txRepo.find({ where: { projectId: id, type: FinanceTxType.INCOME } as any });
    for (const t of incomeTxs) await this.removeTransaction(t.id);
    await this.ppRepo.delete({ projectId: id } as any);
    await this.projRepo.delete(id);
    return { ok: true };
  }

  // Сотрудники
  listEmployees() { return this.empRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  private normStatus(v: any): 'active' | 'fired' { return v === 'fired' || v === 'inactive' ? 'fired' : 'active'; }
  async createEmployee(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Имя обязательно');
    const position = await this.empRepo.count();
    return this.empRepo.save(this.empRepo.create({
      name: dto.name.trim(), role: dto.role ?? null, salary: Number(dto.salary) || 0,
      advance: Number(dto.advance) || 0, hireDate: dto.hireDate ?? null,
      status: this.normStatus(dto.status), position,
    }));
  }
  async updateEmployee(id: string, dto: any) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    if (dto.name !== undefined) e.name = String(dto.name).trim();
    if (dto.role !== undefined) e.role = dto.role;
    if (dto.salary !== undefined) e.salary = Number(dto.salary) || 0;
    if (dto.advance !== undefined) e.advance = Number(dto.advance) || 0;
    if (dto.hireDate !== undefined) e.hireDate = dto.hireDate || null;
    if (dto.status !== undefined) e.status = this.normStatus(dto.status);
    return this.empRepo.save(e);
  }
  async removeEmployee(id: string) { await this.empRepo.delete(id); return { ok: true }; }

  /** Задать бонус сотрудника за месяц (0 — убрать). Хранится в jsonb bonuses,
   *  расход создаётся отдельно — при выплате, вместе с окладом. */
  async setEmployeeBonus(id: string, dto: { ym?: string; amount?: any }) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const ym = dto.ym || currentYm();
    const amount = r2(Number(dto.amount) || 0);
    if (amount < 0) throw new BadRequestException('Бонус не может быть отрицательным');
    const map = { ...(e.bonuses || {}) };
    if (amount > 0) map[ym] = amount;
    else delete map[ym];
    e.bonuses = Object.keys(map).length ? map : null;
    return this.empRepo.save(e);
  }

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

  /** Отметить месяц оплаченным БЕЗ операции в журнале — деньги по счетам
   *  не двигаются (оплата прошла вне системы или уже учтена в балансе). */
  async markSubscriptionPaid(id: string, dto: { ym?: string; date?: string }) {
    const s = await this.subRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Позиция не найдена');
    const ym = dto.ym || currentYm();
    const date = dto.date || todayISO();
    s.paidMarks = [...(s.paidMarks || []).filter(x => x.ym !== ym), { ym, date }];
    return this.subRepo.save(s);
  }

  /** Снять отметку «оплачено без операции» за месяц. */
  async unmarkSubscriptionPaid(id: string, dto: { ym?: string }) {
    const s = await this.subRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Позиция не найдена');
    const ym = dto.ym || currentYm();
    s.paidMarks = (s.paidMarks || []).filter(x => x.ym !== ym);
    return this.subRepo.save(s);
  }

  // Долги
  async listDebts() {
    const debts = await this.debtRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
    const allExp = this.active(await this.txRepo.find({ where: { type: FinanceTxType.EXPENSE } as any }));
    return debts.map(d => ({
      ...d,
      totalAmount: Number(d.totalAmount), monthlyPayment: Number(d.monthlyPayment), paidBefore: Number(d.paidBefore),
      remaining: this.debtRemaining(d, allExp),
    }));
  }
  async createDebt(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = await this.debtRepo.count();
    const d = await this.debtRepo.save(this.debtRepo.create({
      name: dto.name.trim(), counterparty: dto.counterparty ?? null, totalAmount: Number(dto.totalAmount) || 0,
      monthlyPayment: Number(dto.monthlyPayment) || 0, paidBefore: Number(dto.paidBefore) || 0, note: dto.note ?? null, position,
    }));
    await this.regenerateDebtSchedule(d.id);
    return d;
  }
  async updateDebt(id: string, dto: any) {
    const d = await this.debtRepo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Долг не найден');
    if (dto.name !== undefined) d.name = String(dto.name).trim();
    if (dto.counterparty !== undefined) d.counterparty = dto.counterparty ?? null;
    if (dto.totalAmount !== undefined) d.totalAmount = Number(dto.totalAmount) || 0;
    if (dto.paidBefore !== undefined) d.paidBefore = Number(dto.paidBefore) || 0;
    if (dto.monthlyPayment !== undefined) d.monthlyPayment = Number(dto.monthlyPayment) || 0;
    if (dto.note !== undefined) d.note = dto.note;
    const saved = await this.debtRepo.save(d);
    await this.regenerateDebtSchedule(id);
    return saved;
  }
  async removeDebt(id: string) {
    await this.ppRepo.delete({ debtId: id } as any);
    await this.debtRepo.delete(id);
    return { ok: true };
  }

  // ─── Резервная копия / сброс ─────────────────────────────────────
  async exportAll() {
    const [accounts, categories, projects, employees, subscriptions, debts, plannedPayments, transactions] = await Promise.all([
      this.accRepo.find(), this.catRepo.find(), this.projRepo.find(), this.empRepo.find(),
      this.subRepo.find(), this.debtRepo.find(), this.ppRepo.find(), this.txRepo.find(),
    ]);
    return { version: 2, exportedAt: new Date().toISOString(), accounts, categories, projects, employees, subscriptions, debts, plannedPayments, transactions };
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
    await save(this.ppRepo, data.plannedPayments);
    await save(this.txRepo, data.transactions);
    if (!(data.accounts?.length) && !(data.categories?.length)) await this.seedDefaults();
    return { ok: true };
  }

  /** Полный сброс финансовых данных. reseed=true → пересоздаёт дефолты. */
  async resetAll(reseed = true) {
    await this.txRepo.createQueryBuilder().delete().execute();
    await this.ppRepo.createQueryBuilder().delete().execute();
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
