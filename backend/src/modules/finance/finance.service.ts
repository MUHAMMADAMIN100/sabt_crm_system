import {
  Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
import { FinanceAsset } from './entities/finance-asset.entity';
import { FinanceBackup } from './entities/finance-backup.entity';
import { FinanceForecastAdjustment } from './entities/finance-forecast-adjustment.entity';
import { WEBRAND_BACKUP } from './webrand-backup.data';
import { FinanceScheduler } from './finance.scheduler';
import {
  isEarningFinanceProject as isEarning,
  isPostedFinanceTransaction,
  isPostedFinanceTransactionAsOf,
  remainingFinanceAmount,
  salaryForFinanceMonth as salaryForMonth,
  workedInFinanceMonth,
} from './finance-calculations';
import {
  NOTION_ACCOUNTS, NOTION_PROJECT_RENAMES, NOTION_PROJECTS,
  NOTION_EMPLOYEES, NOTION_TRANSACTIONS,
} from './notion-snapshot.data';

// ─── helpers ────────────────────────────────────────────────────────
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** До перехода накоплений на модель «счёт → счёт» они записывались как
 * пополнение одного accountId. Такие строки нельзя переосмыслить без знания
 * исходного счёта, поэтому сохраняем прежнее влияние на баланс. */
function isLegacySaving(t: Pick<FinanceTransaction, 'type' | 'accountId' | 'fromAccountId' | 'toAccountId'>): boolean {
  return t.type === FinanceTxType.SAVING
    && !!t.accountId
    && !t.fromAccountId
    && !t.toAccountId;
}

/** ym = 'YYYY-MM' → диапазон дат месяца [from, to]. */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

const ymOf = (iso: string): string => (iso || '').slice(0, 7);

/** Период зарплатной ведомости для даты — цикл «10-е → 10-е»: дата на/до
 *  10-го числа относится к ПРЕДЫДУЩЕМУ месяцу (цикл закрывается 10-го),
 *  после 10-го — к текущему. Используется как дефолт месяца начисления ЗП,
 *  когда явный salaryYm не задан. Только для зарплаты. */
function salaryPeriodOf(iso: string): string {
  const s = (iso || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return ymOf(iso);
  if (d <= 10) { const dt = new Date(y, m - 2, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Сегодня по Душанбе — сервер (Railway) живёт в UTC: операции с 00:00 до
 *  05:00 местного получали бы вчерашнюю дату, а на стыке месяцев уезжали бы
 *  в прошлый месяц (авансы, циклы, «текущий месяц» автопланов). */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
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

/** Срок второй части после получения первой — 15 дней (правило компании). */
const PART2_DUE_DAYS = 15;

/** Бонус сотрудника за месяц (jsonb bonuses: { '2026-07': 500 }). */
function bonusOf(e: { bonuses?: Record<string, number> | null }, ym: string): number {
  return r2(Number((e.bonuses || {})[ym]) || 0);
}

/** Аванс сотрудника за месяц (помесячно, как бонус). Legacy-колонка advance
 *  в расчётах больше не участвует (решение владельца: обнулить историю). */
function advanceOf(e: { advances?: Record<string, number> | null }, ym: string): number {
  return r2(Number((e.advances || {})[ym]) || 0);
}

/** Классификация зарплатной операции по комментарию: аванс и бонус
 *  ВЫДАЮТСЯ СРАЗУ отдельными операциями (просьба владельца), финальная
 *  выплата — всё остальное. */
function isAdvanceTx(t: { comment?: string | null }): boolean {
  return (t.comment || '').trim().toLowerCase().startsWith('аванс');
}
/** Заметка пользователя без служебного маркера типа операции.
 *  Маркер («Зарплата»/«Аванс»/«Бонус») обязан оставаться первым словом —
 *  по нему операция и относится к своей колонке ведомости. */
function salaryNoteOf(comment?: string | null): string | null {
  const raw = (comment || '').trim();
  const m = raw.match(/^(зарплата|аванс|бонус)[ \t]*[—–-][ \t]*(.+)$/i);
  return m ? m[2].trim() || null : null;
}

function isBonusTx(t: { comment?: string | null }): boolean {
  return (t.comment || '').trim().toLowerCase().startsWith('бонус');
}

/** Штраф сотрудника за месяц — вычитается из «к выплате». */
function fineOf(e: { fines?: Record<string, number> | null }, ym: string): number {
  return r2(Number((e.fines || {})[ym]) || 0);
}

/** Снапшот выплаченного месяца (месяц заморожен, правки его не меняют). */
function snapOf(e: { salarySnapshots?: Record<string, any> | null }, ym: string) {
  return (e.salarySnapshots || {})[ym] || null;
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
  { name: 'Development', type: 'income', key: 'development', builtin: true, icon: 'development', color: '#2563eb', position: 3 },
  { name: 'Design', type: 'income', key: 'design', builtin: true, icon: 'design', color: '#a855f7', position: 4 },
  { name: 'Обслуживание', type: 'income', key: 'maintenance', builtin: true, icon: 'maintenance', color: '#0f766e', position: 17 },
  { name: 'Возврат долга', type: 'income', key: 'debt_return', builtin: true, icon: 'undo', color: '#14b8a6', position: 5 },
  { name: 'Прочее', type: 'income', key: null, builtin: false, icon: 'box', color: '#64748b', position: 6 },
  // Расходы
  { name: 'Зарплата', type: 'expense', key: 'salary', builtin: true, icon: 'banknote', color: '#f59e0b', position: 7 },
  { name: 'Реклама (ADS)', type: 'expense', key: null, builtin: false, icon: 'megaphone', color: '#ef4444', position: 8 },
  { name: 'Аренда', type: 'expense', key: 'rent', builtin: true, icon: 'building', color: '#8b5cf6', position: 9 },
  { name: 'Подписки', type: 'expense', key: 'subscription', builtin: true, icon: 'creditCard', color: '#ec4899', position: 10 },
  { name: 'Транспорт', type: 'expense', key: null, builtin: false, icon: 'car', color: '#06b6d4', position: 11 },
  { name: 'Печать', type: 'expense', key: null, builtin: false, icon: 'printer', color: '#6366f1', position: 12 },
  { name: 'Налоги', type: 'expense', key: null, builtin: false, icon: 'percent', color: '#b45309', position: 13 },
  { name: 'Долг', type: 'expense', key: 'debt', builtin: true, icon: 'receipt', color: '#e11d48', position: 14 },
  { name: 'Прочее', type: 'expense', key: null, builtin: false, icon: 'box', color: '#64748b', position: 15 },
  // Накопление
  { name: 'Накопление', type: 'saving', key: null, builtin: false, icon: 'piggy', color: '#10b981', position: 16 },
];

/** Направление → системный ключ категории дохода. */
const DIRECTION_CATEGORY_KEY: Record<string, string> = {
  smm: 'smm', development: 'development', design: 'design', maintenance: 'maintenance',
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
    @InjectRepository(FinanceAsset) private assetRepo: Repository<FinanceAsset>,
    @InjectRepository(FinanceBackup) private backupRepo: Repository<FinanceBackup>,
    @InjectRepository(FinanceForecastAdjustment) private forecastAdjRepo: Repository<FinanceForecastAdjustment>,
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
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "terminationDate" date`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "employmentHistory" jsonb`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "bonuses" jsonb`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "category" varchar(80)`);
    // Помесячные авансы/штрафы + снапшоты выплаченных месяцев (месяцы независимы).
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "advances" jsonb`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "fines" jsonb`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "salarySnapshots" jsonb`);
    await run(`ALTER TABLE finance_employees ADD COLUMN IF NOT EXISTS "salaryHistory" jsonb`);
    await run(`UPDATE finance_employees SET "salaryHistory" = jsonb_build_object(
      to_char(COALESCE("hireDate", "createdAt"::date), 'YYYY-MM'), salary)
      WHERE "salaryHistory" IS NULL OR "salaryHistory" = '{}'::jsonb`);
    // Журнал активности финансов (кто/что/когда) — пишет интерцептор.
    await run(`CREATE TABLE IF NOT EXISTS finance_activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userId" uuid, action varchar(160) NOT NULL, route varchar(200) NOT NULL,
      details jsonb, "createdAt" timestamptz NOT NULL DEFAULT now())`);
    await run(`CREATE INDEX IF NOT EXISTS idx_fin_activity_created ON finance_activity ("createdAt" DESC)`);
    await run(`CREATE TABLE IF NOT EXISTS finance_forecast_adjustments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL,
      type varchar(12) NOT NULL, amount numeric(15,2) NOT NULL,
      "startYm" varchar(7) NOT NULL, "endYm" varchar(7), recurrence varchar(12) NOT NULL DEFAULT 'once',
      scenario varchar(16) NOT NULL DEFAULT 'all', note text,
      "createdAt" timestamptz NOT NULL DEFAULT now())`);
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
    // День оплаты подписки/аренды — для напоминаний.
    await run(`ALTER TABLE finance_subscriptions ADD COLUMN IF NOT EXISTS "dueDay" int`);
    // Дата постановки проекта на паузу (статус 'paused').
    await run(`ALTER TABLE finance_projects ADD COLUMN IF NOT EXISTS "pausedAt" date`);
    // Архивные счета: скрыты из карточек и селектов, история цела.
    await run(`ALTER TABLE finance_accounts ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false`);

    // Снимки данных (автобэкап кроном + ручные из настроек).
    await run(`CREATE TABLE IF NOT EXISTS finance_backups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind varchar(16) NOT NULL DEFAULT 'auto',
      stats jsonb, data jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())`);

    // Плановые оплаты (SMM части, матрицы Dev/Design, график долгов).
    await run(`CREATE TABLE IF NOT EXISTS finance_planned_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "projectId" uuid, "debtId" uuid,
      ym varchar(7), "partNo" int DEFAULT 1, amount numeric(15,2) DEFAULT 0,
      status varchar(16) DEFAULT 'expected', "receivedTxId" uuid, auto boolean DEFAULT false,
      "createdAt" timestamptz DEFAULT now())`);
    await run(`ALTER TABLE finance_planned_payments ADD COLUMN IF NOT EXISTS "dueDate" date`);

    // Инвентарь (оборудование + линейная амортизация).
    await run(`CREATE TABLE IF NOT EXISTS finance_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(200) NOT NULL,
      category varchar(60), "purchaseDate" date, price numeric(15,2) NOT NULL DEFAULT 0,
      "serviceMonths" int NOT NULL DEFAULT 0, status varchar(16) NOT NULL DEFAULT 'in_use',
      assignee varchar(200), serial varchar(120), "warrantyUntil" date, note text,
      position int NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now())`);
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
    // Месяц начисления ЗП: колонка + бэкфилл (месяц из даты) для старых
    // зарплатных операций — картина не меняется, значение становится явным.
    await run(`ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS "salaryYm" varchar(7)`);
    await run(`UPDATE finance_transactions SET "salaryYm" = to_char("date", 'YYYY-MM')
      WHERE "employeeId" IS NOT NULL AND type = 'expense' AND "salaryYm" IS NULL`);
    await run(`CREATE INDEX IF NOT EXISTS "IDX_fin_tx_posted_date_type"
      ON finance_transactions (date, type)
      WHERE COALESCE(status, 'completed') = 'completed'`);
    await run(`CREATE INDEX IF NOT EXISTS "IDX_fin_tx_employee_salary_ym"
      ON finance_transactions ("employeeId", "salaryYm")`);
    await run(`CREATE INDEX IF NOT EXISTS "IDX_fin_tx_project_date"
      ON finance_transactions ("projectId", date)`);
    await run(`CREATE INDEX IF NOT EXISTS "IDX_fin_tx_subscription_date"
      ON finance_transactions ("subscriptionId", date)`);
    await run(`CREATE INDEX IF NOT EXISTS "IDX_fin_tx_debt_date"
      ON finance_transactions ("debtId", date)`);

    await this.seedDefaults();

    // Разовое обновление иконок/цветов дефолтных категорий (стиль референса,
    // разные цвета). Каждый UPDATE срабатывает ТОЛЬКО если иконка/цвет ещё
    // старые дефолтные — ручные правки пользователя не затрагиваем.
    // Маркер в finance_activity гарантирует однократность.
    try {
      const mark = 'SYSTEM category-icons-v2';
      const done = await this.ds.query(`SELECT 1 FROM finance_activity WHERE route = $1 LIMIT 1`, [mark]);
      if (!done.length) {
        const upd = async (sql: string, params: any[]) => { try { await this.ds.query(sql, params); } catch (e: any) { this.logger.warn(`cat-icon upd: ${String(e?.message || e).slice(0, 120)}`); } };
        // ВАЖНО: иконку и цвет обновляем РАЗДЕЛЬНО, каждый — только если
        // соответствующее старое значение ещё дефолтное. Иначе комбинированный
        // UPDATE по одному лишь old-icon затирал бы кастомный ЦВЕТ (цвет можно
        // было менять и раньше через палитру, иконку — нет).
        await upd(`UPDATE finance_categories SET color=$1 WHERE key='development' AND color=$2`, ['#2563eb', '#0ea5e9']);
        await upd(`UPDATE finance_categories SET icon=$1 WHERE key='debt_return' AND icon=$2`, ['undo', 'plus']);
        await upd(`UPDATE finance_categories SET icon=$1 WHERE key='salary' AND icon=$2`, ['banknote', 'salary']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE key='salary' AND color=$2`, ['#f59e0b', '#f97316']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE key='rent' AND color=$2`, ['#8b5cf6', '#e11d48']);
        await upd(`UPDATE finance_categories SET icon=$1 WHERE key='subscription' AND icon=$2`, ['creditCard', 'transactions']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE key='subscription' AND color=$2`, ['#ec4899', '#d946ef']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE key='debt' AND color=$2`, ['#e11d48', '#d97706']);
        // Не-builtin дефолты — по имени+типу, если иконка/цвет ещё дефолтные.
        await upd(`UPDATE finance_categories SET icon=$1 WHERE name='Реклама (ADS)' AND type='expense' AND icon=$2`, ['megaphone', 'target']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE name='Транспорт' AND type='expense' AND color=$2`, ['#06b6d4', '#0891b2']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE name='Печать' AND type='expense' AND color=$2`, ['#6366f1', '#7c3aed']);
        await upd(`UPDATE finance_categories SET icon=$1 WHERE name='Накопление' AND type='saving' AND icon=$2`, ['piggy', 'income']);
        await upd(`UPDATE finance_categories SET color=$1 WHERE name='Накопление' AND type='saving' AND color=$2`, ['#10b981', '#7c3aed']);
        await upd(`UPDATE finance_categories SET icon=$1 WHERE name='Прочее' AND icon=$2`, ['box', 'dots']);
        await this.ds.query(
          `INSERT INTO finance_activity (action, route, details) VALUES ('Иконки/цвета категорий обновлены (стиль референса)', $1, '{}'::jsonb)`,
          [mark],
        );
        this.logger.log('finance category icons v2 applied');
      }
    } catch (e: any) {
      this.logger.warn(`category-icons migration failed: ${String(e?.message || e).slice(0, 160)}`);
    }

    // Бэкфилл: старые записи с enum-счётом → на новый accountId по ключу.
    await run(`UPDATE finance_transactions t SET "accountId" = a.id
      FROM finance_accounts a WHERE t."accountId" IS NULL AND t.account IS NOT NULL AND a.key = t.account`);
    // Legacy: сотрудники со статусом 'inactive' → 'fired'.
    await run(`UPDATE finance_employees SET status = 'fired' WHERE status = 'inactive'`);

    // Разовая правка (18.07.2026): ранее июль-2026 был принудительно «закрыт»
    // снапшотами (когда месяц ЗП определялся датой операции). С вводом
    // «месяца начисления» (salaryYm) июль снова становится ОТКРЫТЫМ месяцем —
    // пересчитываем снапшот июля по операциям месяца начисления: где выплат
    // нет, заморозка снимается и можно вносить авансы/штрафы/бонусы за июль.
    // Балансы НЕ затрагиваются (снапшоты денег не двигают). Маркер в
    // finance_activity — однократность; старый маркер auto-close-2026-07
    // оставлен как есть, повторно месяц не закрываем.
    try {
      const mark = 'SYSTEM reopen-2026-07-salaryYm';
      const done = await this.ds.query(
        `SELECT 1 FROM finance_activity WHERE route = $1 LIMIT 1`, [mark],
      );
      if (!done.length) {
        const emps = await this.empRepo.find();
        for (const e of emps) await this.refreshSalarySnapshot(e.id, '2026-07');
        await this.ds.query(
          `INSERT INTO finance_activity (action, route, details)
           VALUES ('Июль 2026 переоткрыт (ввод «месяца начисления» зарплаты)', $1, '{}'::jsonb)`,
          [mark],
        );
        this.logger.log('salary reopen 2026-07 (salaryYm) done');
      }
    } catch (e: any) {
      this.logger.warn(`salary reopen migration failed: ${String(e?.message || e).slice(0, 160)}`);
    }

    // История оклада появилась позже июньской ведомости. Первая версия
    // заполнила её текущим окладом с даты найма, из-за чего прошлые месяцы
    // некоторых сотрудников показывали будущую ставку. Замороженные снимки
    // ведомостей — точный источник суммы конкретного месяца: добавляем точку
    // изменения только там, где история с ним расходится. Операции и балансы
    // не меняются. Маркер делает восстановление строго однократным.
    try {
      const mark = 'SYSTEM salary-history-from-snapshots-v1';
      const done = await this.ds.query(
        `SELECT 1 FROM finance_activity WHERE route = $1 LIMIT 1`, [mark],
      );
      if (!done.length) {
        const emps = await this.empRepo.find();
        let repaired = 0;
        for (const employee of emps) {
          const history = { ...(employee.salaryHistory || {}) };
          let changed = false;
          for (const ym of Object.keys(employee.salarySnapshots || {}).sort()) {
            const snapshotSalary = r2(Number((employee.salarySnapshots || {})[ym]?.salary) || 0);
            const effective = Object.keys(history).filter(m => m <= ym).sort().pop();
            const historicalSalary = effective
              ? r2(Number(history[effective]) || 0)
              : r2(Number(employee.salary) || 0);
            if (historicalSalary !== snapshotSalary) {
              history[ym] = snapshotSalary;
              changed = true;
            }
          }
          if (changed) {
            employee.salaryHistory = history;
            await this.empRepo.save(employee);
            repaired++;
          }
        }
        await this.ds.query(
          `INSERT INTO finance_activity (action, route, details)
           VALUES ('История окладов восстановлена из закрытых ведомостей', $1, $2::jsonb)`,
          [mark, JSON.stringify({ repaired })],
        );
        this.logger.log(`salary history repaired from snapshots: ${repaired}`);
      }
    } catch (e: any) {
      this.logger.warn(`salary-history repair failed: ${String(e?.message || e).slice(0, 160)}`);
    }

    // После восстановления старого месяца обязательно отделяем от него
    // текущую ставку. Например: в июне было 1 500, сейчас 2 500 — история
    // должна содержать обе точки, иначе июньская сумма ошибочно продолжит
    // действовать и в июле. Если уже заведено будущее повышение, current
    // salary относится к нему и текущий месяц автоматически не дописываем.
    try {
      const mark = 'SYSTEM salary-history-current-rate-v1';
      const done = await this.ds.query(
        `SELECT 1 FROM finance_activity WHERE route = $1 LIMIT 1`, [mark],
      );
      if (!done.length) {
        const ym = currentYm();
        const emps = await this.empRepo.find();
        let repaired = 0;
        for (const employee of emps) {
          if (!workedInFinanceMonth(employee, ym)) continue;
          const history = { ...(employee.salaryHistory || {}) };
          const hasFutureRate = Object.keys(history).some(month => month > ym);
          if (hasFutureRate || salaryForMonth(employee, ym) === r2(Number(employee.salary) || 0)) continue;
          history[ym] = r2(Number(employee.salary) || 0);
          employee.salaryHistory = history;
          await this.empRepo.save(employee);
          repaired++;
        }
        await this.ds.query(
          `INSERT INTO finance_activity (action, route, details)
           VALUES ('Текущие оклады отделены от исторических ставок', $1, $2::jsonb)`,
          [mark, JSON.stringify({ ym, repaired })],
        );
        this.logger.log(`current salary history points repaired: ${repaired}`);
      }
    } catch (e: any) {
      this.logger.warn(`current salary-history repair failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  private async seedDefaults() {
    try {
      if (await this.accRepo.count() === 0) {
        await this.accRepo.save(DEFAULT_ACCOUNTS.map(a => this.accRepo.create({ ...a, startBalance: 0 })));
      }
      if (await this.catRepo.count() === 0) {
        await this.catRepo.save(DEFAULT_CATEGORIES.map(c => this.catRepo.create(c)));
      } else {
        const maintenance = await this.catRepo.findOne({ where: { key: 'maintenance' } });
        if (!maintenance) {
          const def = DEFAULT_CATEGORIES.find(c => c.key === 'maintenance');
          if (def) await this.catRepo.save(this.catRepo.create(def));
        }
        await this.backfillCategoryIcons();
      }
      // Реальные legacy-снимки нельзя незаметно загружать в новую/очищенную
      // базу. Они доступны только для явной одноразовой миграции.
      if (process.env.FINANCE_SEED_LEGACY_DATA === 'true') {
        await this.seedWebRand();
        await this.seedNotionSnapshot();
        await this.linkNotionSubscriptionPayments();
        await this.linkNotionSmmParts();
      }
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
        direction: ['smm', 'development', 'design', 'maintenance'].includes(c.group) ? c.group : 'smm',
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

  /** Группа дашборда: направления дохода; расход → salary/rent_subs/debts. */
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

  /** Фактические операции на текущую дату. Pending, отменённые и будущие
   * проводки остаются в журнале/прогнозе, но ещё не являются фактом. */
  private active(txs: FinanceTransaction[]) {
    return this.postedAsOf(txs);
  }

  /** Проведённые, включая датированные будущим — для планового денежного
   * потока. В текущий факт они попадут только в свою дату. */
  private posted(txs: FinanceTransaction[]) {
    return txs.filter(isPostedFinanceTransaction);
  }

  /** Проводки, влияющие на остаток на указанную дату. */
  private postedAsOf(txs: FinanceTransaction[], asOf = todayISO()) {
    return txs.filter(t => isPostedFinanceTransactionAsOf(t, asOf));
  }

  /** Зарплатные операции МЕСЯЦА НАЧИСЛЕНИЯ ym: salaryYm = ym, а для старых
   *  операций без salaryYm — по дате (fallback). Деньги/баланс/журнал живут
   *  по date; здесь — только атрибуция «за какой месяц». Отменённые исключены. */
  private async salaryTxForMonth(ym: string, employeeId?: string): Promise<FinanceTransaction[]> {
    const { from, to } = monthRange(ym);
    const qb = this.txRepo.createQueryBuilder('t')
      .where('t.type = :type', { type: FinanceTxType.EXPENSE })
      .andWhere('t."employeeId" IS NOT NULL')
      .andWhere(`COALESCE(t.status,'completed') = 'completed'`)
      .andWhere('t.date <= :asOf', { asOf: todayISO() })
      .andWhere('(t."salaryYm" = :ym OR (t."salaryYm" IS NULL AND t.date BETWEEN :from AND :to))', { ym, from, to });
    if (employeeId) qb.andWhere('t."employeeId" = :eid', { eid: employeeId });
    return qb.getMany();
  }

  /** Пожизненный баланс счёта = startBalance + приходы − расходы + переводы. */
  private lifetimeBalance(a: FinanceAccount, txs: FinanceTransaction[]): number {
    let bal = Number(a.startBalance);
    for (const t of txs) {
      const amt = Number(t.amount);
      if (t.type === FinanceTxType.INCOME && t.accountId === a.id) bal += amt;
      else if (t.type === FinanceTxType.EXPENSE && t.accountId === a.id) bal -= amt;
      else if (isLegacySaving(t) && t.accountId === a.id) bal += amt;
      else if (t.type === FinanceTxType.TRANSFER || t.type === FinanceTxType.SAVING) {
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
    const balanceTx = this.postedAsOf(allTx);
    const monthTx = allTx.filter(t => t.date >= from && t.date <= to);
    const planned = await this.ppRepo.find();
    const subs = await this.subRepo.find();

    const monthIncome = monthTx.filter(t => t.type === FinanceTxType.INCOME);
    const monthExpense = monthTx.filter(t => t.type === FinanceTxType.EXPENSE);
    const income = this.sum(monthIncome);
    const expense = this.sum(monthExpense);

    // Балансы счетов (пожизненные); архивные счета в карточки не выводим.
    const balances = [...m.accounts]
      .filter(a => !a.archived)
      .sort((a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : 1))
      .map(a => ({
        accountId: a.id, name: a.name, color: a.color ?? null,
        kind: a.kind ?? (a.key === 'cash' ? 'cash' : 'bank'), balance: this.lifetimeBalance(a, balanceTx),
      }));

    // Разбивка месяца по категориям.
    const incomeByCategory: Array<{
      categoryId: string | null; name: string; icon: string | null; color: string | null;
      total: number; plan?: number;
    }> = this.byCategoryList(monthIncome, m);
    const expenseByCategory = this.byCategoryList(monthExpense, m);

    // План/факт дохода по направлениям (пауза и лиды — вне денег).
    const dirs = ['smm', 'development', 'design', 'maintenance'];
    const earningProjectIds = new Set(m.projects.filter(isEarning).map(p => p.id));
    const incomePlan = dirs.map(dir => {
      const projs = m.projects.filter(p => p.direction === dir && isEarning(p));
      const historicalIds = new Set(m.projects.filter(p => p.direction === dir).map(p => p.id));
      const plan = r2(projs.reduce((s, p) => s + Number(p.tariff), 0));
      const fact = this.sum(monthIncome.filter(t => t.projectId && historicalIds.has(t.projectId)));
      return { direction: dir, plan, fact };
    });

    // «Получено / получим» на карточке «Доход за месяц»: план месяца направления
    // из таблиц планов (получено деньгами + ещё ожидается; освоенное вне счёта
    // не считаем — его не будет в журнале). План вешаем только на базовую
    // категорию направления, чтобы подкатегории
    // SMM 1/2 не задваивали его; направление без операций получает строку с нулём.
    for (const dir of dirs) {
      const ids = new Set(m.projects
        .filter(p => p.direction === dir && isEarning(p))
        .map(p => p.id));
      const planMonth = r2(planned
        .filter(pp => pp.ym === ym && pp.projectId && ids.has(pp.projectId)
          && (pp.status === 'expected' || (pp.status === 'received' && pp.receivedTxId)))
        .reduce((s, pp) => s + Number(pp.amount), 0));
      if (planMonth <= 0) continue;
      const baseCat = m.categories.find(c => c.key === dir);
      if (!baseCat) continue;
      let row = incomeByCategory.find(r => r.categoryId === baseCat.id);
      if (!row) {
        row = { categoryId: baseCat.id, name: baseCat.name, icon: baseCat.icon ?? null, color: baseCat.color ?? null, total: 0 };
        incomeByCategory.push(row);
      }
      row.plan = planMonth;
    }
    incomeByCategory.sort((a, b) => b.total - a.total || (b.plan ?? 0) - (a.plan ?? 0));

    // Зарплата: построчно, с учётом снапшотов (замороженный месяц — остаток 0,
    // план = фактически выплаченному). Аванс/бонус — выдачи операциями.
    const activeEmps = m.employees.filter(e => workedInFinanceMonth(e, ym));
    const salaryFund = r2(activeEmps.reduce((s, e) => s + salaryForMonth(e, ym), 0));
    // «Потрачено на ЗП» — движение денег по ДАТЕ (для карточки расхода/сверки
    // со счётом). Обязательство и остаток к выплате — по месяцу НАЧИСЛЕНИЯ.
    const salaryPaid = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'salary'));
    const salaryAccrualTx = await this.salaryTxForMonth(ym);
    let salaryToPayAcc = 0, salaryPlanAcc = 0, salaryAdvAcc = 0, salaryBonAcc = 0;
    for (const e of activeEmps) {
      const snap = snapOf(e, ym);
      if (snap) {
        salaryPlanAcc += r2(Number(snap.paid) || 0);
        salaryAdvAcc += r2(Number(snap.advance) || 0);
        salaryBonAcc += r2(Number(snap.bonus) || 0);
        continue;
      }
      const txs = salaryAccrualTx.filter(t => t.employeeId === e.id);
      const paid = r2(txs.reduce((s, t) => s + Number(t.amount), 0));
      const adv = r2(txs.filter(isAdvanceTx).reduce((s, t) => s + Number(t.amount), 0));
      const bon = r2(txs.filter(isBonusTx).reduce((s, t) => s + Number(t.amount), 0));
      const due = r2(Math.max(0, salaryForMonth(e, ym) + bon - fineOf(e, ym)));
      salaryPlanAcc += due;
      salaryToPayAcc += Math.max(0, due - paid);
      salaryAdvAcc += adv; salaryBonAcc += bon;
    }
    const salaryToPay = r2(salaryToPayAcc);
    const salaryPlan = r2(salaryPlanAcc);
    const salaryAdvances = r2(salaryAdvAcc);
    const salaryBonuses = r2(salaryBonAcc);

    // Аренда/подписки.
    const subsMonthly = r2(subs.filter(s => s.active).reduce((s, x) => s + Number(x.amount), 0));
    const rentSubFact = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'rent_subs'));

    // Долги.
    const totalDebt = r2(m.debts.reduce((s, d) => s + this.debtRemaining(d, allTx), 0));
    const debtPlan = r2(m.debts.reduce((s, d) => s + Math.min(Number(d.monthlyPayment), this.debtRemaining(d, allTx)), 0));
    const debtFact = this.sum(monthExpense.filter(t => this.groupOf(t, m) === 'debts'));

    const expensePlan = [
      // План ЗП — полное обязательство месяца (фонд + бонусы − авансы), а не
      // остаток: после выплат «потрачено 31 750 / план 0» выглядело нонсенсом.
      { group: 'salary', plan: salaryPlan, fact: salaryPaid },
      { group: 'rent_subs', plan: subsMonthly, fact: rentSubFact },
      { group: 'debts', plan: debtPlan, fact: debtFact },
    ];

    const expectedIncome = r2(planned
      .filter(p => p.status === 'expected' && p.projectId && earningProjectIds.has(p.projectId))
      .reduce((s, p) => s + Number(p.amount), 0));

    // Доход: ожидается ещё в ЭТОМ месяце, прогноз следующего месяца
    // (SMM — тарифы активных проектов: цикл повторяется каждый месяц;
    // Dev/Design — ожидаемые планы матриц на следующий месяц) и за всё время.
    const expectedThisMonth = r2(planned
      .filter(pp => pp.projectId && pp.status === 'expected' && pp.ym === ym && earningProjectIds.has(pp.projectId))
      .reduce((s, pp) => s + Number(pp.amount), 0));
    const nextYm = shiftYm(ym, 1);
    const smmForecast = r2(m.projects
      .filter(p => p.direction === 'smm' && isEarning(p))
      .reduce((s, p) => s + Number(p.tariff), 0));
    const otherIds = new Set(m.projects
      .filter(p => p.direction !== 'smm' && isEarning(p))
      .map(p => p.id));
    const otherForecast = r2(planned
      .filter(pp => pp.projectId && otherIds.has(pp.projectId) && pp.status === 'expected' && pp.ym === nextYm)
      .reduce((s, pp) => s + Number(pp.amount), 0));
    const forecastNextMonth = r2(smmForecast + otherForecast);
    const incomeAllTime = this.sum(allTx.filter(t => t.type === FinanceTxType.INCOME));
    const expenseAllTime = this.sum(allTx.filter(t => t.type === FinanceTxType.EXPENSE));

    // Амортизация за просматриваемый месяц: линейная доля цены активов,
    // у которых месяц входит в срок службы (списанные/проданные не считаем).
    const assets = await this.assetRepo.find();
    const amortMonthly = r2(assets.reduce((s, a) => {
      const price = Number(a.price) || 0;
      const life = Number(a.serviceMonths) || 0;
      if (price <= 0 || life <= 0 || !a.purchaseDate) return s;
      if (a.status === 'written_off' || a.status === 'sold') return s;
      const startYm = ymOf(a.purchaseDate);
      return ym >= startYm && ym <= shiftYm(startYm, life - 1) ? s + price / life : s;
    }, 0));

    // Динамика 12 месяцев (по просматриваемый включительно) для графика тренда.
    const monthlySeries = Array.from({ length: 12 }, (_, i) => shiftYm(ym, i - 11)).map(mm => {
      const { from: mf, to: mt } = monthRange(mm);
      const mTx = allTx.filter(t => t.date >= mf && t.date <= mt);
      const inc = this.sum(mTx.filter(t => t.type === FinanceTxType.INCOME));
      const exp = this.sum(mTx.filter(t => t.type === FinanceTxType.EXPENSE));
      return { ym: mm, income: inc, expense: exp, profit: r2(inc - exp) };
    });

    const stats = {
      expectedIncome, expectedThisMonth, forecastNextMonth, incomeAllTime, expenseAllTime,
      salaryToPay, salaryFund, salaryAdvances, salaryBonuses, salaryPaid, totalDebt, subsMonthly,
      amortMonthly,
    };

    const transactions = await this.decorate(this.sortByDateDesc(monthTx), m);

    return {
      ym, income, expense, profit: r2(income - expense),
      balances, incomeByCategory, expenseByCategory, incomePlan, expensePlan, stats, transactions,
      monthlySeries,
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

  /** Разбивка карточки на под-типы для мини-окна при наведении.
   *  kind='category' (id=categoryId | 'none' для «Без категории», txType),
   *  kind='group' (id=salary|rent_subs|debts|other — статьи расхода),
   *  kind='direction' (id=smm|development|design|maintenance — направления дохода).
   *  Считается по РЕАЛЬНЫМ операциям месяца (как карточки), деньги не трогаем. */
  async breakdown(ym: string, kind: string, id: string, txType?: string) {
    const { from, to } = monthRange(ym);
    const m = await this.maps();
    const agg = new Map<string, number>();
    const add = (label: string, amount: number) => agg.set(label, r2((agg.get(label) || 0) + Number(amount)));

    // Направление дохода: карточки считают ПЛАНОВЫЕ оплаты по месяцу плана
    // (pp.ym, received) только по «зарабатывающим» проектам — разбивка должна
    // считать ТАК ЖЕ, иначе сумма окна разойдётся с числом карточки (поздняя
    // оплата в другом месяце, доход по проекту на паузе, доход без плана).
    if (kind === 'direction') {
      // Факт исторический: архив/пауза сегодня не должны менять прошлый месяц.
      const ids = new Set(m.projects.filter(p => p.direction === id).map(p => p.id));
      const actualIncome = this.active(await this.txRepo.find({
        where: { date: Between(from, to), type: FinanceTxType.INCOME } as any,
      }));
      let count = 0;
      for (const tx of actualIncome) {
        if (!tx.projectId || !ids.has(tx.projectId)) continue;
        add(m.proj.get(tx.projectId)?.name || 'Без проекта', Number(tx.amount));
        count++;
      }
      return this.finalizeBreakdown(agg, count);
    }

    // Категория / статья расхода — по РЕАЛЬНЫМ операциям месяца (совпадает
    // с суммами карточек, которые тоже по операциям и дате).
    const all = this.active(await this.txRepo.find({ where: { date: Between(from, to) } as any }));
    let txs: FinanceTransaction[] = [];
    let salaryMode = false;
    if (kind === 'category') {
      const t = txType === 'income' ? FinanceTxType.INCOME : FinanceTxType.EXPENSE;
      txs = all.filter(x => x.type === t && ((id && id !== 'none') ? x.categoryId === id : !x.categoryId));
      salaryMode = !!id && m.cat.get(id)?.key === 'salary';
    } else if (kind === 'group') {
      if (id === 'other') {
        txs = all.filter(x => x.type === FinanceTxType.EXPENSE && !['salary', 'rent_subs', 'debts'].includes(this.groupOf(x, m) || ''));
      } else {
        txs = all.filter(x => x.type === FinanceTxType.EXPENSE && this.groupOf(x, m) === id);
        salaryMode = id === 'salary';
      }
    }

    const labelOf = (t: FinanceTransaction): string => {
      if (salaryMode) return isAdvanceTx(t) ? 'Авансы' : isBonusTx(t) ? 'Бонусы' : 'Зарплата';
      // Подписки/аренда: имя позиции хранится в комментарии операции.
      if (kind === 'group' && id === 'rent_subs') return (t.comment || '').trim() || 'Аренда/подписка';
      if (kind === 'group' && id === 'debts') return (t.debtId && m.debt.get(t.debtId)?.name) || (t.comment || '').trim() || 'Долг';
      return (t.comment || '').trim() || 'Без описания';
    };
    for (const t of txs) add(labelOf(t), Number(t.amount));
    return this.finalizeBreakdown(agg, txs.length);
  }

  /** Сборка результата разбивки: сортировка по убыванию, топ-8 + «Прочее». */
  private finalizeBreakdown(agg: Map<string, number>, count: number) {
    const rows = [...agg.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
    const total = r2(rows.reduce((s, r) => s + r.amount, 0));
    const TOP = 8;
    const items = rows.length > TOP
      ? [...rows.slice(0, TOP), { label: 'Прочее', amount: r2(rows.slice(TOP).reduce((s, r) => s + r.amount, 0)) }]
      : rows;
    return { items, total, count };
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
    const { from, to } = monthRange(ym);
    const actualIncome = this.active(await this.txRepo.find({
      where: { type: FinanceTxType.INCOME, date: Between(from, to) } as any,
    }));
    const dirs = ['smm', 'development', 'design', 'maintenance'];
    return dirs.map(dir => {
      const projs = m.projects.filter(p => p.direction === dir && isEarning(p));
      const earningIds = new Set(projs.map(p => p.id));
      const historicalIds = new Set(m.projects.filter(p => p.direction === dir).map(p => p.id));
      const forMonth = planned.filter(p => p.ym === ym && p.projectId && earningIds.has(p.projectId));
      const received = this.sum(actualIncome.filter(t => t.projectId && historicalIds.has(t.projectId)));
      const expected = r2(forMonth.filter(p => p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0));
      const paused = m.projects.filter(p => p.direction === dir && !p.archived && p.status === 'paused');
      return {
        direction: dir, received,
        plan: r2(projs.reduce((s, p) => s + Number(p.tariff), 0)),
        projectCount: projs.length, expected,
        pausedCount: paused.length,
        pausedTariff: r2(paused.reduce((s, p) => s + Number(p.tariff), 0)),
      };
    });
  }

  async incomeDirectionDetail(direction: string, ym: string, start?: string) {
    const m = await this.maps();
    const planned = await this.ppRepo.find();
    const today = todayISO();

    if (direction === 'smm') {
      const projects = m.projects.filter(p => p.direction === 'smm');
      // Пауза — вне рабочей таблицы (фронт показывает их отдельной группой).
      const active = projects.filter(isEarning);
      const archived = projects.filter(p =>
        p.archived || ['done', 'archived'].includes(p.status || ''));
      // Планы, попавшие в ячейки строк, — для честных итогов частей в tfoot.
      const displayedPlans: FinancePlannedPayment[] = [];
      const rows = active.map(p => {
        const pPlans = planned.filter(x => x.projectId === p.id);
        const tariff = Number(p.tariff);
        const monthPlans = pPlans.filter(x => x.ym === ym);

        // Отображаемый цикл. Первый транш платят в день подписания — цикл
        // может начаться в прошлом месяце и перетечь в текущий (остаток
        // через 15 дней). Если в просматриваемом месяце планов нет,
        // показываем последний прошлый цикл: пока он не закрыт, либо если
        // он закрыт оплатой уже в этом месяце (якорь попал в этот месяц).
        let cyclePlans = monthPlans;
        if (!monthPlans.length) {
          const prevYm = [...new Set(pPlans.filter(x => x.ym < ym).map(x => x.ym))].sort().pop();
          if (prevYm) {
            const prev = pPlans.filter(x => x.ym === prevYm);
            const prevPaid = r2(prev.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
            const unclosed = tariff > 0 && prevPaid < tariff - 0.005;
            const closedThisYm = !!p.cycleAnchor && ymOf(p.cycleAnchor) === ym;
            if (unclosed || closedThisYm) cyclePlans = prev;
          }
        }
        displayedPlans.push(...cyclePlans);

        // В слоте может оказаться два плана (частичная оплата = received +
        // expected-остаток): показываем received (с ним работает «↩»),
        // остаток виден отдельной строкой «остаток …». Сортировка — для
        // детерминизма (repo.find() без ORDER BY).
        const partOf = (n: number) => {
          const x = cyclePlans
            .filter(y => y.partNo === n)
            .sort((a, b) => (a.status === b.status
              ? (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0)
              : a.status === 'received' ? -1 : 1))[0];
          return x ? { plannedId: x.id, amount: Number(x.amount), status: x.status, txId: x.receivedTxId, dueDate: x.dueDate ?? null } : null;
        };
        const paidLife = r2(pPlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
        const cyclePaid = r2(cyclePlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
        // Ближайший ожидаемый платёж ЛЮБОГО месяца: у частично оплаченных
        // остаток может числиться в прошлом месяце — иначе срок не виден
        // (жалоба «не показывает, когда должны»).
        const nextPlan = pPlans
          .filter(x => x.status === 'expected')
          .sort((a, b) => ((a.dueDate ?? `${a.ym}-01`) < (b.dueDate ?? `${b.ym}-01`) ? -1 : 1))[0] ?? null;
        return {
          project: { id: p.id, name: p.name, tariff, contractDate: p.contractDate, archived: p.archived, note: p.note },
          // Дата цикла «катится»: контракт 20.01 → в просмотре февраля 20.02.
          cycleDate: this.smmCycleDate(p, ym),
          part1: partOf(1), part2: partOf(2), paidLife, monthPaid: cyclePaid,
          nextDue: nextPlan ? { plannedId: nextPlan.id, ym: nextPlan.ym, amount: Number(nextPlan.amount), dueDate: nextPlan.dueDate ?? null } : null,
          // «Оплачено» — про отображаемый цикл (не пожизненно).
          fullyPaid: tariff > 0 && cyclePaid >= tariff - 0.005,
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
      // Итоги частей — по планам, отображаемым в ячейках строк (включая
      // перетёкшие циклы прошлого месяца), чтобы tfoot совпадал с таблицей.
      const part1 = r2(displayedPlans.filter(x => x.partNo === 1).reduce((s, x) => s + Number(x.amount), 0));
      const part2 = r2(displayedPlans.filter(x => x.partNo === 2).reduce((s, x) => s + Number(x.amount), 0));
      return {
        kind: 'smm', rows,
        stats: { expected, receivedCash, spentOffAccount, total: r2(expected + receivedCash) },
        totals: { tariff: r2(active.reduce((s, p) => s + Number(p.tariff), 0)), part1, part2, full: r2(part1 + part2) },
        needPay: rows.filter(r => r.alert === 'pay').length,
        needRest: rows.filter(r => r.alert === 'rest').length,
        archived: archived.map(p => ({ id: p.id, name: p.name, tariff: Number(p.tariff), contractDate: p.contractDate })),
      };
    }

    if (direction === 'development' || direction === 'maintenance') {
      const active = m.projects.filter(p => p.direction === direction && isEarning(p));
      const winStart = start || this.defaultStart(active, planned);
      const months = Array.from({ length: 6 }, (_, i) => shiftYm(winStart, i));
      // Обслуживание — регулярный месячный доход. Отсутствующие планы
      // вычисляются для представления, но GET ничего не пишет в БД. План
      // материализуется только при явном сохранении/получении пользователем.
      const viewPlans = [...planned];
      if (direction === 'maintenance') {
        for (const project of active) {
          const tariff = r2(Number(project.tariff) || 0);
          if (tariff <= 0) continue;
          const firstYm = project.contractDate ? ymOf(project.contractDate) : months[0];
          const dueDay = contractDay(project.contractDate) ?? 1;
          for (const month of months) {
            if (month < firstYm) continue;
            const existing = viewPlans.find(pp => pp.projectId === project.id && pp.ym === month);
            if (existing) continue;
            const virtual = this.ppRepo.create({
              projectId: project.id,
              ym: month,
              partNo: 1,
              amount: tariff,
              status: 'expected',
              dueDate: dueDateForMonth(month, dueDay),
              auto: false,
            });
            virtual.id = `virtual:${project.id}:${month}`;
            viewPlans.push(virtual);
          }
        }
      }
      // Даты операций — для «когда получили» на полученных планах ячеек.
      const devIncome = this.active(await this.txRepo.find({ where: { type: FinanceTxType.INCOME } as any }));
      const txDates = new Map(devIncome.map(t => [t.id, t.date]));
      const { rows, totals } = this.buildMatrix(active, viewPlans, months, txDates);
      const ids = new Set(active.map(p => p.id));
      const cm = currentYm();
      const stExpected = r2(viewPlans.filter(x => x.projectId && ids.has(x.projectId) && x.ym === cm && x.status === 'expected').reduce((s, x) => s + Number(x.amount), 0));
      const stReceived = r2(viewPlans.filter(x => x.projectId && ids.has(x.projectId) && x.ym === cm && x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
      return { kind: 'matrix', months, rows, totals, stats: { expected: stExpected, received: stReceived, total: totals.tariff } };
    }

    if (direction === 'design') {
      const designAll = m.projects.filter(p => p.direction === 'design' && isEarning(p));
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
      const matrix = { ...this.buildMatrix(matrixClients, planned, months, new Map(allIncome.map(t => [t.id, t.date]))), months };

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

  /** Матрица «проект × месяц»: строки с ячейками и итоги по месяцам.
   *  txDates — дата операции по receivedTxId: «когда получили» в ячейке. */
  private buildMatrix(clients: FinanceProject[], planned: FinancePlannedPayment[], months: string[], txDates?: Map<string, string>) {
    const ids = new Set(clients.map(c => c.id));
    const rows = clients.map(p => {
      const pPlans = planned.filter(x => x.projectId === p.id);
      const paidLife = r2(pPlans.filter(x => x.status === 'received').reduce((s, x) => s + Number(x.amount), 0));
      const scheduledLife = r2(pPlans.reduce((s, x) => s + Number(x.amount), 0));
      const cells = months.map(mm => {
        const cp = pPlans.filter(x => x.ym === mm);
        return {
          ym: mm,
          plans: cp.map(x => ({
            id: x.id, amount: Number(x.amount), status: x.status, txId: x.receivedTxId, dueDate: x.dueDate ?? null,
            virtual: String(x.id).startsWith('virtual:'),
            receivedAt: x.receivedTxId ? (txDates?.get(x.receivedTxId) ?? null) : null,
          })),
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

    const activeEmps = m.employees.filter(e => workedInFinanceMonth(e, ym));
    const salaryFund = r2(activeEmps.reduce((s, e) => s + salaryForMonth(e, ym), 0));
    const salarySpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'salary'));
    // Построчно, с учётом снапшотов (замороженный месяц: остаток 0).
    // Аванс/бонус — фактические выдачи операциями (входят в «выплачено»);
    // обязательство = оклад + бонусы − штраф.
    // По месяцу НАЧИСЛЕНИЯ (salaryYm), а не по дате выплаты.
    const salarySummaryTx = await this.salaryTxForMonth(ym);
    let salaryAdvances = 0, salaryBonuses = 0, salaryFines = 0, salaryToPayAgg = 0, salaryPaidCount = 0;
    for (const e of activeEmps) {
      const snap = snapOf(e, ym);
      if (snap) {
        salaryAdvances += r2(Number(snap.advance) || 0);
        salaryBonuses += r2(Number(snap.bonus) || 0);
        salaryFines += r2(Number(snap.fine) || 0);
        salaryPaidCount++;
        continue;
      }
      const txs = salarySummaryTx.filter(t => t.employeeId === e.id);
      const paid = r2(txs.reduce((s, t) => s + Number(t.amount), 0));
      const adv = r2(txs.filter(isAdvanceTx).reduce((s, t) => s + Number(t.amount), 0));
      const bon = r2(txs.filter(isBonusTx).reduce((s, t) => s + Number(t.amount), 0));
      const fine = fineOf(e, ym);
      const due = r2(Math.max(0, salaryForMonth(e, ym) + bon - fine));
      const toPay = r2(Math.max(0, due - paid));
      salaryAdvances += adv; salaryBonuses += bon; salaryFines += fine; salaryToPayAgg += toPay;
      const gross = r2(salaryForMonth(e, ym) + bon);
      // Полкопейки допуска — сумма float'ов может недотянуть до r2-округлённого due.
      if (gross > 0 && (due <= 0 || paid >= due - 0.005)) salaryPaidCount++;
    }
    salaryAdvances = r2(salaryAdvances); salaryBonuses = r2(salaryBonuses);
    salaryFines = r2(salaryFines); salaryToPayAgg = r2(salaryToPayAgg);

    const activeSubs = subs.filter(s => s.active);
    const subsCount = activeSubs.length;
    const subMonthly = r2(activeSubs.reduce((s, x) => s + Number(x.amount), 0));
    const subsSpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'rent_subs'));
    // Позиции, оплаченные за месяц: операцией журнала или отметкой без операции.
    const subRemaining = (s: FinanceSubscription) => {
      if ((s.paidMarks || []).some(x => x.ym === ym)) return 0;
      const paid = this.sum(monthExp.filter(t => t.subscriptionId === s.id));
      return remainingFinanceAmount(Number(s.amount), paid);
    };
    const subsPaidCount = activeSubs.filter(s => subRemaining(s) === 0).length;
    // Осталось оплатить за месяц — карточка «Аренда и подписки» уменьшается
    // с каждой оплатой, как у зарплаты.
    const subsToPay = r2(activeSubs.reduce((sum, s) => sum + subRemaining(s), 0));

    const debtIds = new Set(m.debts.map(d => d.id));
    const debtsSpent = this.sum(monthExp.filter(t => this.groupOf(t, m) === 'debts'));
    const totalRemaining = r2(m.debts.reduce((s, d) => s + this.debtRemaining(d, allExp), 0));
    const dueMonth = r2(planned.filter(p => p.debtId && debtIds.has(p.debtId) && p.ym === ym && p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0));
    // Месячное обязательство по долгам — как в эталоне (карточка «Долги» на
    // странице Расход и план/факт Обзора): Σ min(платёж/мес, остаток).
    const debtsMonthly = r2(m.debts.reduce((s, d) => s + Math.min(Number(d.monthlyPayment) || 0, this.debtRemaining(d, allExp)), 0));
    const debtCount = m.debts.filter(d => this.debtRemaining(d, allExp) > 0).length;

    const otherSpent = this.sum(monthExp.filter(t => !['salary', 'rent_subs', 'debts'].includes(this.groupOf(t, m) || '')));

    return {
      ym,
      salary: { spent: salarySpent, count: activeEmps.length, paidCount: salaryPaidCount, bonuses: salaryBonuses, fines: salaryFines, toPay: salaryToPayAgg },
      subscriptions: { spent: subsSpent, count: subsCount, paidCount: subsPaidCount, monthly: subMonthly, toPay: subsToPay },
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
      // Зарплатная таблица собирается по МЕСЯЦУ НАЧИСЛЕНИЯ (salaryYm), а не по
      // дате: выплата за июнь 10 июля попадает в июньскую таблицу.
      const salaryTx = await this.salaryTxForMonth(ym);
      const paidOf = (id: string) => r2(salaryTx.filter(t => t.employeeId === id).reduce((s, t) => s + Number(t.amount), 0));
      // Авансы и бонусы ВЫДАЮТСЯ СРАЗУ отдельными операциями — колонки
      // показывают фактически выданное за месяц (по комментарию операции).
      const advPaidOf = (id: string) => r2(salaryTx.filter(t => t.employeeId === id && isAdvanceTx(t)).reduce((s, t) => s + Number(t.amount), 0));
      const bonPaidOf = (id: string) => r2(salaryTx.filter(t => t.employeeId === id && isBonusTx(t)).reduce((s, t) => s + Number(t.amount), 0));
      const activeEmps = emps.filter(e => workedInFinanceMonth(e, ym));
      const rows = activeEmps.map(e => {
        // Выплаченный месяц ЗАМОРОЖЕН снапшотом: любые будущие правки оклада/
        // бонусов/штрафов его не меняют — месяцы независимы.
        const snap = snapOf(e, ym);
        if (snap) {
          return {
            id: e.id, name: e.name, role: e.role, category: e.category ?? null,
            hireDate: e.hireDate, terminationDate: e.terminationDate,
            salaryHistory: e.salaryHistory || {},
            salary: r2(Number(snap.salary) || 0), advance: r2(Number(snap.advance) || 0),
            bonus: r2(Number(snap.bonus) || 0), fine: r2(Number(snap.fine) || 0),
            status: e.status, paid: r2(Number(snap.paid) || 0), toPay: 0,
            frozen: true, paidAt: snap.paidAt ?? null,
          };
        }
        const paid = paidOf(e.id);
        const advance = advPaidOf(e.id); // уже выдано (входит в paid)
        const bonus = bonPaidOf(e.id);   // уже выдано (входит в paid)
        const fine = fineOf(e, ym);      // удерживается при финальной выплате
        return {
          id: e.id, name: e.name, role: e.role, category: e.category ?? null,
          hireDate: e.hireDate, terminationDate: e.terminationDate,
          salary: salaryForMonth(e, ym), salaryHistory: e.salaryHistory || {},
          advance, bonus, fine, status: e.status, paid,
          // Обязательство месяца = оклад + выданные бонусы − штраф; аванс и
          // бонус уже внутри «выплачено», поэтому остаток = оклад − штраф −
          // (финальные выплаты + авансы).
          toPay: r2(Math.max(0, salaryForMonth(e, ym) + bonus - fine - paid)),
          frozen: false, paidAt: null,
        };
      });
      const fund = r2(rows.reduce((s, e) => s + Number(e.salary), 0));
      const advances = r2(rows.reduce((s, e) => s + Number(e.advance), 0));
      const bonuses = r2(rows.reduce((s, e) => s + Number(e.bonus), 0));
      const fines = r2(rows.reduce((s, e) => s + Number(e.fine || 0), 0));
      const paid = r2(rows.reduce((s, e) => s + Number(e.paid), 0));
      // Все выплачены → фронт автоматически показывает следующий месяц.
      const allPaid = rows.length > 0 && rows.every(r => r.frozen || r.toPay <= 0);
      return {
        kind: 'salary',
        cards: { fund, advances, bonuses, fines, paid, toPay: r2(rows.reduce((s, e) => s + Number(e.toPay), 0)) },
        rows,
        allPaid,
        // Полный набор полей: модалка редактирования открывается и из этой
        // таблицы — усечённая строка затирала category/hireDate.
        fired: emps.filter(e => e.status !== 'active').map(e => ({
          id: e.id, name: e.name, role: e.role, category: e.category ?? null,
          hireDate: e.hireDate, terminationDate: e.terminationDate,
          salary: salaryForMonth(e, ym), salaryHistory: e.salaryHistory || {}, advance: advanceOf(e, ym), status: e.status,
        })),
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
          dueDay: s.dueDay ?? null,
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
      return {
        kind: 'debts', months, rows, totals,
        stats: {
          totalDebt: r2(debts.reduce((s, d) => s + this.debtRemaining(d, allExp), 0)),
          dueMonth: r2(planned.filter(p => p.debtId && ids.has(p.debtId) && p.ym === ym && p.status === 'expected').reduce((s, p) => s + Number(p.amount), 0)),
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
    const txs = this.postedAsOf(await this.txRepo.find());
    const perAccount = accounts.map(a => {
      let income = 0, expense = 0, transferIn = 0, transferOut = 0, saving = 0, legacySaving = 0;
      for (const t of txs) {
        const amt = Number(t.amount);
        if (t.type === FinanceTxType.INCOME && t.accountId === a.id) income += amt;
        else if (t.type === FinanceTxType.EXPENSE && t.accountId === a.id) expense += amt;
        else if (isLegacySaving(t) && t.accountId === a.id) {
          saving += amt;
          legacySaving += amt;
        }
        else if (t.type === FinanceTxType.TRANSFER || t.type === FinanceTxType.SAVING) {
          if (t.fromAccountId === a.id) transferOut += amt;
          if (t.toAccountId === a.id) transferIn += amt;
          if (t.type === FinanceTxType.SAVING && t.toAccountId === a.id) saving += amt;
        }
      }
      const balance = r2(Number(a.startBalance) + income + legacySaving + transferIn - expense - transferOut);
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

  // ─── ФИНАНСОВОЕ ПЛАНИРОВАНИЕ ─────────────────────────────────────
  async forecast(start = currentYm(), months = 12, scenario = 'base') {
    if (!YM_RE.test(start)) start = currentYm();
    months = Math.min(24, Math.max(3, Number(months) || 12));
    if (!['base', 'conservative', 'optimistic'].includes(scenario)) scenario = 'base';
    const yms = Array.from({ length: months }, (_, i) => shiftYm(start, i));
    const [balances, projects, employees, subscriptions, debts, plans, allTx, adjustments, categories] = await Promise.all([
      this.accountsBalances(), this.projRepo.find(), this.empRepo.find(), this.subRepo.find(),
      this.debtRepo.find(), this.ppRepo.find(), this.txRepo.find(), this.forecastAdjRepo.find({ order: { createdAt: 'DESC' } }),
      this.catRepo.find(),
    ]);
    const postedTxs = this.posted(allTx);
    const txs = this.postedAsOf(postedTxs);
    const futureTxs = postedTxs.filter(t => t.date > todayISO());
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const employeeMap = new Map(employees.map(e => [e.id, e]));
    const subscriptionMap = new Map(subscriptions.map(s => [s.id, s]));
    const debtMap = new Map(debts.map(d => [d.id, d]));
    const categoryMap = new Map(categories.map(c => [c.id, c]));
    const incomeFactor = scenario === 'conservative' ? .75 : scenario === 'optimistic' ? 1.1 : 1;
    const expenseFactor = scenario === 'conservative' ? 1.1 : 1;
    // Строка месяца показывает факт + оставшийся прогноз. Поэтому начинаем
    // не с сегодняшнего остатка, а с баланса на начало выбранного периода:
    // так уже проведённые деньги видны в месяце и не удваиваются в остатке.
    const beforeStart = postedTxs.filter(t => ymOf(t.date) < start);
    let opening = r2(Number(balances.total.startBalance)
      + this.sum(beforeStart.filter(t => t.type === FinanceTxType.INCOME))
      - this.sum(beforeStart.filter(t => t.type === FinanceTxType.EXPENSE))
      + this.sum(beforeStart.filter(isLegacySaving)));
    const debtRemaining = new Map(debts.map(d => [d.id, this.debtRemaining(d, txs.filter(t => t.type === FinanceTxType.EXPENSE))]));
    const rows = yms.map(ym => {
      const incomeSources: any[] = [], expenseSources: any[] = [];
      const actual = txs.filter(t => ymOf(t.date) === ym);
      const actualIncomeTx = actual.filter(t => t.type === FinanceTxType.INCOME);
      const actualExpenseTx = actual.filter(t => t.type === FinanceTxType.EXPENSE);
      const scheduled = futureTxs.filter(t => ymOf(t.date) === ym);
      const scheduledIncomeTx = scheduled.filter(t => t.type === FinanceTxType.INCOME);
      const scheduledExpenseTx = scheduled.filter(t => t.type === FinanceTxType.EXPENSE);
      const actualLegacySaving = this.sum(actual.filter(isLegacySaving));
      const scheduledLegacySaving = this.sum(scheduled.filter(isLegacySaving));
      const categoryKey = (t: FinanceTransaction) => t.categoryId ? categoryMap.get(t.categoryId)?.key ?? null : null;
      // Старые/ручные операции могли быть записаны только в категорию, без
      // ссылки на конкретного сотрудника/подписку/долг. Эти суммы тоже
      // гасят обязательства месяца, распределяясь по строкам ниже.
      let unlinkedSalaryPaid = this.sum(actualExpenseTx.filter(t => !t.employeeId && categoryKey(t) === 'salary'));
      let unlinkedSubPaid = this.sum(actualExpenseTx.filter(t => !t.subscriptionId && ['rent', 'subscription'].includes(categoryKey(t) || '')));
      let unlinkedDebtPaid = this.sum(actualExpenseTx.filter(t => !t.debtId && categoryKey(t) === 'debt'));
      for (const t of actualIncomeTx) {
        incomeSources.push({
          key: `actual:${t.id}`,
          label: (t.projectId ? projectMap.get(t.projectId)?.name : null) || t.comment || 'Проведённый доход',
          amount: Number(t.amount), kind: 'Уже получено', actual: true,
        });
      }
      for (const t of actualExpenseTx) {
        expenseSources.push({
          key: `actual:${t.id}`,
          label: (t.employeeId ? employeeMap.get(t.employeeId)?.name : null)
            || (t.subscriptionId ? subscriptionMap.get(t.subscriptionId)?.name : null)
            || (t.debtId ? debtMap.get(t.debtId)?.name : null)
            || t.comment || 'Проведённый расход',
          amount: Number(t.amount), kind: t.employeeId ? 'Зарплата · оплачено' : 'Уже оплачено',
          actual: true, salary: !!t.employeeId,
        });
      }
      for (const t of scheduledIncomeTx) {
        incomeSources.push({
          key: `scheduled:${t.id}`,
          label: (t.projectId ? projectMap.get(t.projectId)?.name : null)
            || t.comment || 'Запланированный доход',
          amount: Number(t.amount), kind: `Запланировано на ${t.date}`, actual: false,
        });
      }
      for (const t of scheduledExpenseTx) {
        expenseSources.push({
          key: `scheduled:${t.id}`,
          label: (t.employeeId ? employeeMap.get(t.employeeId)?.name : null)
            || (t.subscriptionId ? subscriptionMap.get(t.subscriptionId)?.name : null)
            || (t.debtId ? debtMap.get(t.debtId)?.name : null)
            || t.comment || 'Запланированный расход',
          amount: Number(t.amount), kind: `Запланировано на ${t.date}`,
          actual: false, salary: !!t.employeeId,
        });
      }
      const canProject = ym >= currentYm();
      const explicit = new Set<string>();
      for (const pp of plans.filter(p => canProject && p.ym === ym && p.status === 'expected' && p.projectId)) {
        const project = projectMap.get(pp.projectId!);
        if (!project || !isEarning(project)) continue;
        explicit.add(project.id);
        incomeSources.push({ key: `plan:${pp.id}`, label: project.name, amount: r2(Number(pp.amount) * incomeFactor), kind: 'Плановая оплата' });
      }
      for (const project of projects.filter(p => canProject && isEarning(p) && ['smm', 'maintenance'].includes(p.direction))) {
        const received = this.sum(postedTxs.filter(t =>
          t.type === FinanceTxType.INCOME
          && t.projectId === project.id
          && ymOf(t.date) === ym));
        const remaining = Math.max(0, Number(project.tariff) - received);
        if (!explicit.has(project.id) && remaining > 0)
          incomeSources.push({ key: `recurring:${project.id}`, label: project.name, amount: r2(remaining * incomeFactor), kind: project.direction === 'maintenance' ? 'Обслуживание' : 'Регулярный доход' });
      }
      for (const employee of employees.filter(e => canProject)) {
        // Зарплата — денежный поток следующего месяца: начисление за июль
        // выплачивается в августе. Закрытый снапшотом период уже оплачен.
        const salaryYm = shiftYm(ym, -1);
        if (!workedInFinanceMonth(employee, salaryYm)) continue;
        if (snapOf(employee, salaryYm)) continue;
        const exactPaid = this.sum(postedTxs.filter(t => t.type === FinanceTxType.EXPENSE && t.employeeId === employee.id &&
          (t.salaryYm || salaryPeriodOf(t.date)) === salaryYm));
        const due = Math.max(0, salaryForMonth(employee, salaryYm) + bonusOf(employee, salaryYm) - fineOf(employee, salaryYm));
        let amount = Math.max(0, due - exactPaid);
        const covered = Math.min(amount, unlinkedSalaryPaid);
        amount -= covered;
        unlinkedSalaryPaid = r2(unlinkedSalaryPaid - covered);
        if (amount) expenseSources.push({ key: `salary:${employee.id}`, label: employee.name, amount: r2(amount * expenseFactor), kind: 'Зарплата · ожидается', salary: true });
      }
      for (const sub of subscriptions.filter(s => canProject && s.active && Number(s.amount) > 0)) {
        const markedPaid = (sub.paidMarks || []).some(x => x.ym === ym);
        const exactPaid = this.sum([...actualExpenseTx, ...scheduledExpenseTx].filter(t => t.subscriptionId === sub.id));
        let amount = markedPaid ? 0 : Math.max(0, Number(sub.amount) - exactPaid);
        const covered = Math.min(amount, unlinkedSubPaid);
        amount -= covered;
        unlinkedSubPaid = r2(unlinkedSubPaid - covered);
        if (amount) expenseSources.push({ key: `sub:${sub.id}`, label: sub.name, amount: r2(amount * expenseFactor), kind: 'Подписка / аренда' });
      }
      for (const debt of debts) {
        if (!canProject) continue;
        const remaining = debtRemaining.get(debt.id) || 0;
        if (remaining <= 0) continue;
        const scheduled = plans.filter(p => p.ym === ym && p.debtId === debt.id).reduce((s, p) => s + Number(p.amount), 0);
        const exactPaid = this.sum([...actualExpenseTx, ...scheduledExpenseTx].filter(t => t.debtId === debt.id));
        const scheduledPaid = this.sum(scheduledExpenseTx.filter(t => t.debtId === debt.id));
        if (scheduledPaid > 0) {
          debtRemaining.set(debt.id, r2(Math.max(0, remaining - scheduledPaid)));
        }
        let dueThisMonth = Math.max(0, (scheduled || Number(debt.monthlyPayment) || 0) - exactPaid);
        const covered = Math.min(dueThisMonth, unlinkedDebtPaid);
        dueThisMonth -= covered;
        unlinkedDebtPaid = r2(unlinkedDebtPaid - covered);
        const amount = Math.min(remaining, dueThisMonth);
        if (amount > 0) {
          expenseSources.push({ key: `debt:${debt.id}`, label: debt.name, amount: r2(amount * expenseFactor), kind: 'Погашение долга' });
          debtRemaining.set(debt.id, r2(remaining - amount));
        }
      }
      for (const adj of adjustments.filter(a => canProject && (a.scenario === 'all' || a.scenario === scenario) &&
        a.startYm <= ym && (!a.endYm || a.endYm >= ym) && (a.recurrence === 'monthly' || a.startYm === ym))) {
        (adj.type === 'income' ? incomeSources : expenseSources).push({
          key: `adjustment:${adj.id}`, label: adj.name, amount: Number(adj.amount), kind: 'Ручная корректировка', adjustmentId: adj.id,
        });
      }
      const income = r2(incomeSources.reduce((s, x) => s + x.amount, 0));
      const expense = r2(expenseSources.reduce((s, x) => s + x.amount, 0));
      const actualIncome = this.sum(actualIncomeTx);
      const actualExpense = this.sum(actualExpenseTx);
      const plannedIncome = r2(Math.max(0, income - actualIncome));
      const plannedExpense = r2(Math.max(0, expense - actualExpense));
      const closingBalance = r2(opening + income - expense + actualLegacySaving + scheduledLegacySaving);
      const row = { ym, openingBalance: opening, income, expense, net: r2(income - expense), closingBalance,
        balanceNow: ym === currentYm() ? Number(balances.total.balance) : null,
        actualIncome, actualExpense, plannedIncome, plannedExpense,
        incomeSources, expenseSources, warning: closingBalance < 0 };
      opening = closingBalance;
      return row;
    });
    return { start, months, scenario, openingBalance: Number(balances.total.balance), rows, adjustments,
      summary: { expectedIncome: r2(rows.reduce((s, r) => s + r.income, 0)), expectedExpense: r2(rows.reduce((s, r) => s + r.expense, 0)),
        result: r2(rows.reduce((s, r) => s + r.net, 0)), endingBalance: rows.at(-1)?.closingBalance ?? opening,
        minBalance: rows.length ? Math.min(...rows.map(r => r.closingBalance)) : opening,
        cashGapYm: rows.find(r => r.closingBalance < 0)?.ym ?? null } };
  }

  listForecastAdjustments() { return this.forecastAdjRepo.find({ order: { createdAt: 'DESC' } }); }
  async createForecastAdjustment(dto: any) {
    if (!String(dto.name || '').trim()) throw new BadRequestException('Название обязательно');
    if (!['income', 'expense'].includes(dto.type)) throw new BadRequestException('Неверный тип');
    if (!YM_RE.test(dto.startYm || '')) throw new BadRequestException('Укажите месяц');
    return this.forecastAdjRepo.save(this.forecastAdjRepo.create({
      name: String(dto.name).trim(), type: dto.type, amount: Math.max(0, Number(dto.amount) || 0),
      startYm: dto.startYm, endYm: YM_RE.test(dto.endYm || '') ? dto.endYm : null,
      recurrence: dto.recurrence === 'monthly' ? 'monthly' : 'once',
      scenario: ['base', 'conservative', 'optimistic'].includes(dto.scenario) ? dto.scenario : 'all',
      note: String(dto.note || '').trim() || null,
    }));
  }
  async updateForecastAdjustment(id: string, dto: any) {
    const row = await this.forecastAdjRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Корректировка не найдена');
    Object.assign(row, dto);
    return this.forecastAdjRepo.save(row);
  }
  async removeForecastAdjustment(id: string) { await this.forecastAdjRepo.delete(id); return { ok: true }; }

  // ─── ТРАНЗАКЦИИ ──────────────────────────────────────────────────
  private async decorate(txs: FinanceTransaction[], m: FinMaps) {
    return txs.map(t => {
      const cat = t.categoryId ? m.cat.get(t.categoryId) : null;
      return {
        id: t.id, date: t.date, type: t.type, amount: Number(t.amount), status: t.status, comment: t.comment,
        salaryYm: t.salaryYm ?? null,
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

  async listTransactions(f: {
    type?: string;
    search?: string;
    from?: string;
    to?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const m = await this.maps();
    const qb = this.txRepo.createQueryBuilder('t');
    if (f.status === 'cancelled') {
      qb.where(`COALESCE(t.status,'completed') = 'cancelled'`);
    } else if (f.status === 'all') {
      qb.where('1 = 1');
    } else {
      qb.where(`COALESCE(t.status,'completed') <> 'cancelled'`);
    }
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

    if (type === FinanceTxType.TRANSFER || type === FinanceTxType.SAVING) {
      if (!dto.fromAccountId || !dto.toAccountId) throw new BadRequestException('Укажите счёт списания и зачисления');
      if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Счета перевода должны отличаться');
      base.fromAccountId = dto.fromAccountId;
      base.toAccountId = dto.toAccountId;
      if (type === FinanceTxType.SAVING) {
        base.categoryId = dto.categoryId ?? null;
        if (dto.categoryId) base.category = (await this.catRepo.findOne({ where: { id: dto.categoryId } }))?.name ?? null;
      }
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
        const links = [base.employeeId, base.debtId, base.subscriptionId].filter(Boolean);
        if (links.length > 1) {
          throw new BadRequestException('Расход можно привязать только к одному обязательству');
        }
        // Месяц начисления ЗП: явный из формы, иначе — по правилу «10-е → 10-е»
        // (зарплатный период даты), а не по календарному месяцу.
        if (base.employeeId) {
          base.salaryYm = (typeof dto.salaryYm === 'string' && YM_RE.test(dto.salaryYm))
            ? dto.salaryYm : salaryPeriodOf(date);
        }
      }
    }
    const saved = await this.txRepo.save(this.txRepo.create(base));
    await this.syncSmmPartLink(saved.id);
    // Выплата ЗП: если остаток месяца НАЧИСЛЕНИЯ закрыт — фиксируем снапшот
    // (месяц замораживается, будущие правки бонусов/авансов его не меняют).
    if (saved.type === FinanceTxType.EXPENSE && saved.employeeId) {
      await this.refreshSalarySnapshot(saved.employeeId, saved.salaryYm ?? ymOf(saved.date));
    }
    return saved;
  }

  /** Пересчитать снапшот выплаченного месяца сотрудника: закрыт остаток —
   *  фиксируем (или обновляем paid); выплату откатили — размораживаем. */
  private async refreshSalarySnapshot(employeeId: string, ym: string) {
    const e = await this.empRepo.findOne({ where: { id: employeeId } });
    if (!e) return;
    // Операции месяца НАЧИСЛЕНИЯ (по salaryYm, с fallback на дату для старых).
    const monthExp = await this.salaryTxForMonth(ym, employeeId);
    const paid = r2(monthExp.reduce((s, t) => s + Number(t.amount), 0));
    const advance = r2(monthExp.filter(isAdvanceTx).reduce((s, t) => s + Number(t.amount), 0));
    const bonus = r2(monthExp.filter(isBonusTx).reduce((s, t) => s + Number(t.amount), 0));
    const snap = snapOf(e, ym);
    // Параметры месяца: из снапшота (если уже был), иначе живые значения.
    const salary = snap ? r2(Number(snap.salary) || 0) : salaryForMonth(e, ym);
    const fine = snap ? r2(Number(snap.fine) || 0) : fineOf(e, ym);
    // Аванс/бонус уже выданы операциями (входят в paid): обязательство =
    // оклад + бонусы − штраф.
    const due = r2(Math.max(0, salary + bonus - fine));
    const map = { ...(e.salarySnapshots || {}) };
    if (due > 0 && paid >= due - 0.005) {
      map[ym] = { salary, bonus, advance, fine, paid, paidAt: snap?.paidAt || todayISO() };
    } else {
      delete map[ym];
    }
    e.salarySnapshots = Object.keys(map).length ? map : null;
    await this.empRepo.save(e);
  }

  async updateTransaction(id: string, dto: any) {
    const t = await this.txRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Операция не найдена');
    if (t.status === FinanceTxStatus.CANCELLED) {
      throw new BadRequestException('Отменённую операцию нельзя изменять');
    }
    if (dto.amount != null) {
      const a = Number(dto.amount);
      if (!Number.isFinite(a) || a <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
    }
    const patch: any = {};
    for (const k of ['amount', 'date', 'comment', 'categoryId', 'accountId', 'fromAccountId', 'toAccountId', 'projectId', 'employeeId', 'debtId', 'subscriptionId', 'type', 'salaryYm']) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    // Смена типа чистит неприменимые поля (§5.11): перевод/накопление используют
    // from/to; income/expense — один accountId. Иначе после
    // transfer→income остаются старые from/to и операция выпадает из балансов.
    if (patch.type !== undefined && patch.type !== t.type) {
      if (patch.type === FinanceTxType.TRANSFER || patch.type === FinanceTxType.SAVING) {
        patch.accountId = patch.accountId ?? null;
        if (patch.type === FinanceTxType.TRANSFER) patch.categoryId = patch.categoryId ?? null;
        patch.projectId = null; patch.employeeId = null; patch.debtId = null; patch.subscriptionId = null; patch.salaryYm = null;
      } else {
        patch.fromAccountId = null; patch.toAccountId = null;
        if (patch.type !== FinanceTxType.INCOME) patch.projectId = patch.projectId ?? null;
        if (patch.type !== FinanceTxType.EXPENSE) { patch.employeeId = null; patch.debtId = null; patch.subscriptionId = null; patch.salaryYm = null; }
      }
    }
    // salaryYm имеет смысл только для expense с сотрудником (зеркально
    // createOperation): не пишем «мёртвый» salaryYm и чистим его при снятии
    // сотрудника у расхода. 'employeeId' in patch — снятие (employeeId=null)
    // чистит, а обычная правка ЗП (employeeId не прислан) сохраняет.
    const effType = patch.type ?? t.type;
    const effEmp = 'employeeId' in patch ? patch.employeeId : t.employeeId;
    if (effType !== FinanceTxType.EXPENSE || !effEmp) patch.salaryYm = null;
    if (patch.categoryId !== undefined) patch.category = patch.categoryId ? (await this.catRepo.findOne({ where: { id: patch.categoryId } }))?.name ?? null : null;
    const next: any = { ...t, ...patch };
    if (next.type === FinanceTxType.TRANSFER || next.type === FinanceTxType.SAVING) {
      // Старую одиночную запись накопления разрешаем править, не меняя её
      // финансовый смысл. При выборе двух счетов UI мигрирует её в перевод.
      const preservedLegacySaving = t.type === FinanceTxType.SAVING
        && isLegacySaving(t)
        && next.type === FinanceTxType.SAVING
        && isLegacySaving(next);
      if (!preservedLegacySaving) {
        if (!next.fromAccountId || !next.toAccountId) throw new BadRequestException('Укажите счёт списания и зачисления');
        if (next.fromAccountId === next.toAccountId) throw new BadRequestException('Счета должны отличаться');
      }
    } else if (!next.accountId) {
      throw new BadRequestException('Укажите счёт');
    }
    if (next.type === FinanceTxType.EXPENSE
      && [next.employeeId, next.debtId, next.subscriptionId].filter(Boolean).length > 1) {
      throw new BadRequestException('Расход можно привязать только к одному обязательству');
    }
    await this.txRepo.update(id, patch);
    await this.syncSmmPartLink(id);
    // Правка выплаты ЗП (сумма/дата/сотрудник) — пересчитать снапшоты
    // затронутых месяцев: и старого сотрудника/месяца, и нового.
    const after = await this.txRepo.findOne({ where: { id } });
    const touched = new Set<string>();
    if (t.employeeId) touched.add(`${t.employeeId}:${t.salaryYm ?? ymOf(t.date)}`);
    if (after?.employeeId) touched.add(`${after.employeeId}:${after.salaryYm ?? ymOf(after.date)}`);
    for (const key of touched) {
      const [empId, ym] = key.split(':');
      await this.refreshSalarySnapshot(empId, ym);
    }
    return after;
  }

  async removeTransaction(id: string) {
    const { tx, projectId } = await this.ds.transaction(async em => {
      const txRepo = em.getRepository(FinanceTransaction);
      const ppRepo = em.getRepository(FinancePlannedPayment);
      const tx = await txRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tx) throw new NotFoundException('Операция не найдена');
      // Идемпотентно восстанавливаем связанные планы даже после сбоя старой
      // неатомарной версии отмены.
      const linked = await ppRepo.find({ where: { receivedTxId: id } });
      for (const p of linked) {
        if (p.auto) await ppRepo.delete(p.id);
        else {
          p.status = 'expected';
          p.receivedTxId = null;
          await ppRepo.save(p);
        }
      }
      if (tx.status !== FinanceTxStatus.CANCELLED) {
        // Ledger не удаляем: отменённая проводка остаётся доступной для аудита,
        // но исключается из факта и балансов.
        tx.status = FinanceTxStatus.CANCELLED;
        await txRepo.save(tx);
      }
      return {
        tx,
        projectId: tx.projectId ?? linked.find(x => x.projectId)?.projectId ?? null,
      };
    });
    if (tx.employeeId) await this.refreshSalarySnapshot(tx.employeeId, tx.salaryYm ?? ymOf(tx.date));
    if (projectId) await this.resyncSmmAfterUndo(projectId);
    return { ok: true, cancelled: true };
  }

  /** Синхронизирует авто-плановую оплату SMM (часть 1/2) с операцией журнала,
   *  чтобы она отображалась в таблице SMM (категория smm1/smm2 + проект). */
  private async syncSmmPartLink(txId: string) {
    const tx = await this.txRepo.findOne({ where: { id: txId } });
    const existing = await this.ppRepo.findOne({ where: { auto: true, receivedTxId: txId } });
    const key = tx?.categoryId ? (await this.catRepo.findOne({ where: { id: tx.categoryId } }))?.key ?? null : null;
    const partNo = key === 'smm2' ? 2 : key === 'smm1' ? 1 : null;
    const shouldExist = !!(tx
      && isPostedFinanceTransaction(tx)
      && tx.type === FinanceTxType.INCOME
      && tx.projectId
      && partNo);

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
   *    остаток со сроком «дата оплаты части 1 + 15 дней»;
   *  — если цикл оплачен полностью — создаёт ожидаемый платёж следующего
   *    цикла ко дню контракта и уведомляет финансовых пользователей.
   *  Ничего не создаёт, если план на месяц/следующий месяц уже есть. */
  private async ensureSmmFollowUps(projectId?: string | null) {
    if (!projectId) return;
    try {
      const p = await this.projRepo.findOne({ where: { id: projectId } });
      const tariff = Number(p?.tariff) || 0;
      if (!p || p.direction !== 'smm' || !isEarning(p) || tariff <= 0) return;

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
          // Авто-план — подтягиваем срок под новый якорь. Ручной (правленный
          // пользователем через PATCH) не трогаем: договорённость важнее.
          if (existingNext.status === 'expected' && existingNext.auto) {
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
        // Имя проекта в описании — в журнале видно, ЗА ЧТО пришли деньги.
        comment: comment ?? (project?.name ? `Оплата проекта — ${project.name}` : 'Оплата проекта'),
        status: FinanceTxStatus.COMPLETED,
      }));
    }
    const cat = await catRepo.findOne({ where: { key: 'debt' } });
    return txRepo.save(txRepo.create({
      type: FinanceTxType.EXPENSE, amount: Number(pp.amount), date, accountId,
      debtId: pp.debtId, categoryId: cat?.id ?? null, category: cat?.name ?? null,
      comment: comment ?? 'Погашение долга', status: FinanceTxStatus.COMPLETED,
    }));
  }

  /** Правка ожидаемого плана: сумма и/или срок (для received сумма привязана
   *  к операции журнала — правьте её или отмените оплату). */
  async updatePlannedPayment(id: string, dto: any) {
    const pp = await this.ppRepo.findOne({ where: { id } });
    if (!pp) throw new NotFoundException('Плановая оплата не найдена');
    if (pp.status === 'received') throw new BadRequestException('Полученную оплату нельзя править — отмените её или измените операцию в журнале');
    if (dto.amount !== undefined) {
      const amount = Number(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
      pp.amount = r2(amount);
    }
    if (dto.dueDate !== undefined) pp.dueDate = dto.dueDate || null;
    // Ручная правка делает план «ручным»: авто-логика цикла больше не
    // перезапишет его срок и не удалит как сироту при откатах.
    pp.auto = false;
    const saved = await this.ppRepo.save(pp);
    return { ...saved, amount: Number(saved.amount) };
  }

  async receivePlannedPayment(id: string, dto: any) {
    if (!dto.accountId) throw new BadRequestException('Укажите счёт');
    const date = dto.date || todayISO();
    return this.ds.transaction(async (em) => {
      const ppRepo = em.getRepository(FinancePlannedPayment);
      // FOR UPDATE: двойной клик «Получено» не должен дважды пройти сплит
      // (дубли остатков + двойной доход).
      const pp = await ppRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pp) throw new NotFoundException('Плановая оплата не найдена');
      if (pp.status === 'received') throw new BadRequestException('Оплата уже получена');
      const planned = Number(pp.amount);
      const amount = dto.amount !== undefined ? r2(Number(dto.amount)) : planned;
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма должна быть больше нуля');
      if (amount > planned + 0.005) throw new BadRequestException('Сумма больше запланированной — сначала увеличьте план');
      // Частичная оплата: полученная часть закрывается этим планом, на разницу
      // остаётся ожидаемый план с тем же сроком.
      if (amount < planned - 0.005) {
        // SMM, частично оплачена часть 1: остаток кладём во «вторую часть»,
        // если слот свободен — обе видны в таблице частей. Иначе тот же слот
        // (в ячейке приоритет у received, остаток виден в строке «остаток…»).
        let restPartNo = pp.partNo;
        if (pp.projectId && pp.partNo === 1) {
          const proj = await em.getRepository(FinanceProject).findOne({ where: { id: pp.projectId } });
          if (proj?.direction === 'smm') {
            const slotBusy = await ppRepo.findOne({ where: { projectId: pp.projectId, ym: pp.ym, partNo: 2 } });
            if (!slotBusy) restPartNo = 2;
          }
        }
        await ppRepo.save(ppRepo.create({
          projectId: pp.projectId, debtId: pp.debtId, ym: pp.ym, partNo: restPartNo,
          amount: r2(planned - amount), status: 'expected', dueDate: pp.dueDate ?? null, auto: false,
        }));
        pp.amount = amount;
      }
      const tx = await this.buildLinkedTx(em, { projectId: pp.projectId, debtId: pp.debtId, amount }, dto.accountId, date);
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
      if (pp.receivedTxId) {
        await em.getRepository(FinanceTransaction).update(pp.receivedTxId, { status: FinanceTxStatus.CANCELLED });
      }
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
      if (pp.receivedTxId) {
        await em.getRepository(FinanceTransaction).update(pp.receivedTxId, { status: FinanceTxStatus.CANCELLED });
      }
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
      // Антидубль: повторная отправка (даблклик, ретрай сети) с теми же
      // параметрами в течение минуты не должна провести оплату дважды.
      const dupQb = em.getRepository(FinancePlannedPayment).createQueryBuilder('pp')
        .where('pp.ym = :ym AND pp.status = :st AND pp.amount = :amt', { ym: dto.ym, st: 'received', amt: r2(amount) })
        .andWhere(`pp.createdAt > now() - interval '60 seconds'`);
      if (dto.projectId) dupQb.andWhere('pp.projectId = :id', { id: dto.projectId });
      else dupQb.andWhere('pp.debtId = :id', { id: dto.debtId });
      if (await dupQb.getOne()) throw new BadRequestException('Такая оплата только что проведена — проверьте журнал');

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

  /** Отменить все оплаты проекта (кнопка «Отменить оплату» у разовых работ):
   *  планы удаляются, а связанные проводки помечаются отменёнными в одной
   *  транзакции — раньше фронт делал это по одной и обрыв сети оставлял
   *  полусостояние. */
  async cancelProjectPayments(projectId: string) {
    const p = await this.projRepo.findOne({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Проект не найден');
    await this.ds.transaction(async (em) => {
      const pps = await em.getRepository(FinancePlannedPayment).find({ where: { projectId } });
      const txIds = pps.map(x => x.receivedTxId).filter(Boolean) as string[];
      if (txIds.length) {
        await em.getRepository(FinanceTransaction).createQueryBuilder()
          .update().set({ status: FinanceTxStatus.CANCELLED })
          .whereInIds(txIds).execute();
      }
      if (pps.length) await em.getRepository(FinancePlannedPayment).delete(pps.map(x => x.id));
    });
    await this.resyncSmmAfterUndo(projectId);
    return { ok: true };
  }

  /** Снять расходы месяца по сотруднику или подписке одной транзакцией
   *  (отмена выплаты ЗП / оплаты позиции — замена клиентского цикла удалений). */
  async removeMonthExpenses(dto: { ym: string; employeeId?: string; subscriptionId?: string; kind?: 'advance' | 'bonus' }) {
    if (!dto.employeeId && !dto.subscriptionId) throw new BadRequestException('Укажите сотрудника или подписку');
    if (dto.employeeId && dto.subscriptionId) throw new BadRequestException('Либо сотрудник, либо подписка');
    const { from, to } = monthRange(dto.ym);
    const removed = await this.ds.transaction(async (em) => {
      const repo = em.getRepository(FinanceTransaction);
      let txs: FinanceTransaction[];
      if (dto.employeeId) {
        // Отмена выплаты ЗП — по МЕСЯЦУ НАЧИСЛЕНИЯ (salaryYm), с fallback на
        // дату для старых операций без salaryYm.
        txs = await repo.createQueryBuilder('t')
          .where('t.type = :type', { type: FinanceTxType.EXPENSE })
          .andWhere(`COALESCE(t.status,'completed') = 'completed'`)
          .andWhere('t."employeeId" = :eid', { eid: dto.employeeId })
          .andWhere('(t."salaryYm" = :ym OR (t."salaryYm" IS NULL AND t.date BETWEEN :from AND :to))', { ym: dto.ym, from, to })
          .getMany();
        // kind — удалить только авансы или только бонусы (по комментарию).
        if (dto.kind === 'advance') txs = txs.filter(isAdvanceTx);
        else if (dto.kind === 'bonus') txs = txs.filter(isBonusTx);
      } else {
        txs = await repo.find({ where: { type: FinanceTxType.EXPENSE, date: Between(from, to), subscriptionId: dto.subscriptionId } as any });
        txs = txs.filter(isPostedFinanceTransaction);
      }
      if (txs.length) {
        await repo.createQueryBuilder().update()
          .set({ status: FinanceTxStatus.CANCELLED })
          .whereInIds(txs.map(t => t.id)).execute();
      }
      return txs.length;
    });
    // Откат выплат ЗП за месяц — размораживаем снапшот.
    if (dto.employeeId) await this.refreshSalarySnapshot(dto.employeeId, dto.ym);
    return { ok: true, removed };
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
    if (dto.archived !== undefined) a.archived = !!dto.archived;
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
    const direction = ['smm', 'development', 'design', 'maintenance'].includes(dto.direction) ? dto.direction : 'smm';
    let status = ['lead', 'active', 'paused', 'done', 'archived'].includes(dto.status) ? dto.status : 'active';
    const archived = !!dto.archived || status === 'archived';
    if (archived) status = 'archived';
    const position = await this.projRepo.count();
    return this.projRepo.save(this.projRepo.create({
      name: dto.name.trim(), direction, tariff: Number(dto.tariff) || 0, note: dto.note ?? null,
      contractDate: dto.contractDate ?? null, archived, multiMonth: !!dto.multiMonth,
      status, pausedAt: status === 'paused' ? todayISO() : null, position,
    }));
  }
  async updateProject(id: string, dto: any) {
    const p = await this.projRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Проект не найден');
    if (dto.name !== undefined) p.name = String(dto.name).trim();
    if (dto.direction !== undefined && ['smm', 'development', 'design', 'maintenance'].includes(dto.direction)) p.direction = dto.direction;
    if (dto.tariff !== undefined) p.tariff = Number(dto.tariff) || 0;
    if (dto.note !== undefined) p.note = dto.note;
    if (dto.contractDate !== undefined) {
      // Ручная правка даты контракта задаёт новую точку отсчёта цикла —
      // катящийся якорь сбрасывается и заново выставится ближайшей оплатой.
      p.contractDate = dto.contractDate || null;
      p.cycleAnchor = null;
    }
    if (dto.multiMonth !== undefined) p.multiMonth = !!dto.multiMonth;
    const validStatus = dto.status !== undefined
      && ['lead', 'active', 'paused', 'done', 'archived'].includes(dto.status);
    let nextStatus = validStatus ? dto.status : p.status;
    let nextArchived = dto.archived !== undefined ? !!dto.archived : p.archived;
    if (nextStatus === 'archived' || dto.archived === true) {
      nextStatus = 'archived';
      nextArchived = true;
    } else if (validStatus) {
      // Явный перевод архивного проекта в рабочий статус восстанавливает его.
      nextArchived = false;
    } else if (dto.archived === false && nextStatus === 'archived') {
      nextStatus = 'active';
    }
    if (nextStatus !== p.status) {
      const prev = p.status;
      if (nextStatus === 'paused' && prev !== 'paused') {
        p.pausedAt = todayISO();
      } else if (prev === 'paused' && nextStatus !== 'paused') {
        if (nextStatus === 'archived') p.pausedAt = null;
        else await this.resumeFromPause(p);
      }
      p.status = nextStatus;
    }
    p.archived = nextArchived;
    return this.projRepo.save(p);
  }

  /** Возврат проекта с паузы: сроки замороженных ожидаемых платежей и якорь
   *  SMM-цикла сдвигаются на длительность паузы — без ложной «просрочки»
   *  за время простоя. Планы без dueDate (ячейки матриц Dev/Design) не
   *  трогаем — их месяцы правят вручную. */
  private async resumeFromPause(p: FinanceProject) {
    const pausedAt = p.pausedAt;
    p.pausedAt = null;
    if (!pausedAt) return;
    const shift = Math.max(0, Math.round(
      (Date.parse(todayISO() + 'T00:00:00Z') - Date.parse(pausedAt + 'T00:00:00Z')) / 86400000));
    if (shift <= 0) return;
    const pps = await this.ppRepo.find({ where: { projectId: p.id, status: 'expected' } });
    const shifted = pps.filter(pp => pp.dueDate);
    for (const pp of shifted) {
      pp.dueDate = addDays(pp.dueDate as string, shift);
      pp.ym = ymOf(pp.dueDate);
    }
    if (shifted.length) await this.ppRepo.save(shifted);
    if (p.cycleAnchor) p.cycleAnchor = addDays(p.cycleAnchor, shift);
  }
  async removeProject(id: string) {
    const p = await this.projRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Проект не найден');
    // Финансовая история неизменна: «удаление» только архивирует справочник.
    p.archived = true;
    p.status = 'archived';
    p.pausedAt = null;
    await this.projRepo.save(p);
    return { ok: true, archived: true };
  }

  // Сотрудники
  listEmployees() { return this.empRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  private normStatus(v: any): 'active' | 'fired' { return v === 'fired' || v === 'inactive' ? 'fired' : 'active'; }
  async createEmployee(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Имя обязательно');
    const position = await this.empRepo.count();
    const salary = Number(dto.salary) || 0;
    const status = this.normStatus(dto.status);
    const hireDate = dto.hireDate ?? null;
    const terminationDate = dto.terminationDate ?? (status === 'fired' ? todayISO() : null);
    if (status === 'active' && terminationDate) {
      throw new BadRequestException('У активного сотрудника не может быть даты увольнения');
    }
    if (hireDate && terminationDate && terminationDate < hireDate) {
      throw new BadRequestException('Дата увольнения не может быть раньше даты приёма');
    }
    const effectiveYm = YM_RE.test(dto.salaryEffectiveYm || '')
      ? dto.salaryEffectiveYm : ymOf(dto.hireDate || todayISO());
    return this.empRepo.save(this.empRepo.create({
      name: dto.name.trim(), role: dto.role ?? null, salary,
      salaryHistory: { [effectiveYm]: salary },
      advance: Number(dto.advance) || 0, hireDate,
      terminationDate, employmentHistory: null,
      category: (dto.category ?? '').trim() || null,
      status, position,
    }));
  }
  async updateEmployee(id: string, dto: any) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const oldStatus = e.status;
    const oldHireDate = e.hireDate;
    const oldTerminationDate = e.terminationDate;
    if (dto.name !== undefined) e.name = String(dto.name).trim();
    if (dto.role !== undefined) e.role = dto.role;
    if (dto.category !== undefined) e.category = String(dto.category ?? '').trim() || null;
    if (dto.salary !== undefined) {
      const salary = Number(dto.salary) || 0;
      const changed = salary !== Number(e.salary);
      const effectiveYm = YM_RE.test(dto.salaryEffectiveYm || '') ? dto.salaryEffectiveYm : currentYm();
      e.salary = salary;
      if (changed || dto.salaryEffectiveYm) e.salaryHistory = { ...(e.salaryHistory || {}), [effectiveYm]: salary };
    }
    if (dto.advance !== undefined) e.advance = Number(dto.advance) || 0;
    const nextStatus = dto.status !== undefined ? this.normStatus(dto.status) : e.status;
    const reactivating = oldStatus === 'fired' && nextStatus === 'active';
    if (reactivating) {
      // Архивируем значения ДО применения DTO: форма закономерно присылает
      // terminationDate=null при выборе «Работает».
      if (oldHireDate && oldTerminationDate) {
        e.employmentHistory = [
          ...(e.employmentHistory || []),
          { hireDate: oldHireDate, terminationDate: oldTerminationDate },
        ];
      }
      const requestedHireDate = dto.hireDate || null;
      // Старые клиенты формы могли прислать прежнюю дату приёма обратно.
      // Это не новый период — используем сегодняшнюю дату безопасным default.
      const rehireDate = !requestedHireDate || requestedHireDate === oldHireDate
        ? todayISO()
        : requestedHireDate;
      if (oldTerminationDate && rehireDate <= oldTerminationDate) {
        throw new BadRequestException('Дата повторного приёма должна быть позже даты увольнения');
      }
      e.hireDate = rehireDate;
      e.terminationDate = null;
    } else {
      if (dto.hireDate !== undefined) e.hireDate = dto.hireDate || null;
      if (dto.terminationDate !== undefined) e.terminationDate = dto.terminationDate || null;
    }
    if (dto.status !== undefined) {
      if (nextStatus === 'fired' && oldStatus !== 'fired' && dto.terminationDate === undefined) {
        e.terminationDate = todayISO();
      }
      e.status = nextStatus;
    }
    if (e.status === 'active' && e.terminationDate) {
      throw new BadRequestException('У активного сотрудника не может быть даты увольнения');
    }
    if (e.hireDate && e.terminationDate && e.terminationDate < e.hireDate) {
      throw new BadRequestException('Дата увольнения не может быть раньше даты приёма');
    }
    return this.empRepo.save(e);
  }
  async removeEmployee(id: string) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    // Сохраняем ведомости и связи журнала; исключаем только будущие начисления.
    e.status = 'fired';
    e.terminationDate = e.terminationDate || todayISO();
    await this.empRepo.save(e);
    return { ok: true, archived: true };
  }

  /** Задать бонус сотрудника за месяц (0 — убрать). Хранится в jsonb bonuses,
   *  расход создаётся отдельно — при выплате, вместе с окладом. */
  /** Закрыть зарплатный месяц можно только по фактически проведённым выплатам.
   *  Снапшот фиксирует историю, но никогда не погашает обязательство без денег. */
  async closeSalaryMonth(ym: string) {
    const emps = await this.empRepo.find();
    // Выплаченное за месяц — по МЕСЯЦУ НАЧИСЛЕНИЯ (salaryYm), с fallback на дату.
    const monthExp = await this.salaryTxForMonth(ym);
    let closed = 0, skipped = 0;
    for (const e of emps) {
      if (!workedInFinanceMonth(e, ym) || snapOf(e, ym)) continue;
      const employeeTx = monthExp.filter(t => t.employeeId === e.id);
      const paid = r2(employeeTx.reduce((s, t) => s + Number(t.amount), 0));
      const paidAdvance = r2(employeeTx.filter(isAdvanceTx).reduce((s, t) => s + Number(t.amount), 0));
      const paidBonus = r2(employeeTx.filter(isBonusTx).reduce((s, t) => s + Number(t.amount), 0));
      const salary = salaryForMonth(e, ym);
      const fine = fineOf(e, ym);
      const due = r2(Math.max(0, salary + paidBonus - fine));
      if (paid < due - 0.005) {
        skipped++;
        continue;
      }
      const map = { ...(e.salarySnapshots || {}) };
      map[ym] = {
        salary, bonus: paidBonus || bonusOf(e, ym),
        advance: paidAdvance || advanceOf(e, ym), fine,
        paid, paidAt: todayISO(),
      };
      e.salarySnapshots = map;
      await this.empRepo.save(e);
      closed++;
    }
    if (!closed && skipped) {
      throw new BadRequestException('Месяц нельзя закрыть: сначала проведите оставшиеся выплаты по счетам');
    }
    return { ok: true, closed, skipped };
  }

  /** Переоткрыть месяц ЗП: снять заморозку (удалить снапшоты выплаченного
   *  месяца) БЕЗ удаления зарплатных операций и без движения денег.
   *  Нужно, чтобы поправить/дозаполнить авансы/бонусы/штрафы за уже
   *  закрытый месяц (во frozen-месяц их не впишешь). Балансы не меняются. */
  async reopenSalaryMonth(ym: string) {
    const emps = await this.empRepo.find();
    let reopened = 0;
    for (const e of emps) {
      if (!snapOf(e, ym)) continue;
      const map = { ...(e.salarySnapshots || {}) };
      delete map[ym];
      e.salarySnapshots = Object.keys(map).length ? map : null;
      await this.empRepo.save(e);
      reopened++;
    }
    return { ok: true, reopened };
  }

  /** Журнал активности финансов: кто/что/когда (пишет интерцептор). */
  async listActivity(limit = 50, offset = 0) {
    const l = Math.min(200, Math.max(1, Number(limit) || 50));
    const o = Math.max(0, Number(offset) || 0);
    const rows = await this.ds.query(
      `SELECT a.id, a.action, a.route, a.details, a."createdAt", a."userId",
              u.name AS "userName", u.avatar AS "userAvatar"
       FROM finance_activity a
       LEFT JOIN users u ON u.id = a."userId"
       ORDER BY a."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [l, o],
    ).catch(() => []);
    const totalRow = await this.ds.query(`SELECT COUNT(*)::int AS count FROM finance_activity`).catch(() => [{ count: 0 }]);
    // Старые записи журнала уже содержат UUID. Резолвим их при чтении, чтобы
    // улучшение работало для всей истории без изменения исходного аудита.
    const [m, subscriptions, assets, plans] = await Promise.all([
      this.maps(),
      this.subRepo.find(),
      this.assetRepo.find(),
      this.ppRepo.find(),
    ]);
    const sub = new Map(subscriptions.map(x => [x.id, x.name]));
    const asset = new Map(assets.map(x => [x.id, x.name]));
    const plan = new Map(plans.map(x => [x.id, x]));
    const account = new Map(m.accounts.map(x => [x.id, x.name]));
    const category = new Map(m.categories.map(x => [x.id, x.name]));
    const project = new Map(m.projects.map(x => [x.id, x.name]));
    const employee = new Map(m.employees.map(x => [x.id, x.name]));
    const debt = new Map(m.debts.map(x => [x.id, x.name]));
    const typeLabel: Record<string, string> = {
      income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление',
    };
    const statusLabel: Record<string, string> = {
      active: 'Активный', paused: 'На паузе', lead: 'Лид', done: 'Завершён',
      archived: 'В архиве', expected: 'Ожидается', received: 'Получено', fired: 'Уволен',
    };
    const kindLabel: Record<string, string> = {
      advance: 'Аванс', bonus: 'Бонус', salary: 'Зарплата', rent: 'Аренда', subscription: 'Подписка',
    };
    const shortId = (v: any) => typeof v === 'string' && /^[0-9a-f-]{30,}$/i.test(v)
      ? `…${v.slice(-6)}` : v;
    const decorated = rows.map((row: any) => {
      const details = { ...(row.details || {}) };
      const replace = (key: string, lookup: Map<string, any>) => {
        if (details[key]) details[key] = lookup.get(details[key]) || shortId(details[key]);
      };
      replace('accountId', account);
      replace('fromAccountId', account);
      replace('toAccountId', account);
      replace('categoryId', category);
      replace('projectId', project);
      replace('employeeId', employee);
      replace('debtId', debt);
      replace('subscriptionId', sub);
      replace('assetId', asset);
      if (details.type) details.type = typeLabel[details.type] || details.type;
      if (details.status) details.status = statusLabel[details.status] || details.status;
      if (details.kind) details.kind = kindLabel[details.kind] || details.kind;
      if (details.id) {
        const p = plan.get(details.id);
        if (row.route?.includes('/planned-payments') && p) {
          const owner = p.projectId ? m.proj.get(p.projectId)?.name : p.debtId ? m.debt.get(p.debtId)?.name : null;
          details.id = `${owner || 'Плановая оплата'} · ${p.ym}`;
        } else {
          details.id = shortId(details.id);
        }
      }
      return { ...row, details };
    });
    return { rows: decorated, total: totalRow?.[0]?.count ?? 0 };
  }

  async setEmployeeBonus(id: string, dto: { ym?: string; amount?: any }) {
    return this.setEmployeeMonthField(id, 'bonuses', dto, 'Бонус');
  }

  /** Аванс за месяц (помесячно, как бонус). */
  /** История выплат сотруднику: аванс/бонус/зарплата — что, когда, сколько
   *  и с какого счёта. Отдельной таблицы не нужно: каждая выплата и так
   *  создаёт операцию расхода с employeeId — читаем их.
   *
   *  months — за сколько последних месяцев начисления смотреть (по умолчанию
   *  12): история нужна «за последнее время», а не за всю жизнь компании. */
  async employeePayoutHistory(id: string, months = 12) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const m = await this.maps();
    const txs = this.active(await this.txRepo.find({
      where: { employeeId: id, type: FinanceTxType.EXPENSE } as any,
      order: { date: 'DESC' },
    }));
    const minYm = shiftYm(currentYm(), -(months - 1));
    const rows = txs
      .map(t => {
        const kind = isAdvanceTx(t) ? 'advance' : isBonusTx(t) ? 'bonus' : 'salary';
        return {
          id: t.id,
          kind,
          kindLabel: kind === 'advance' ? 'Аванс' : kind === 'bonus' ? 'Бонус' : 'Зарплата',
          amount: r2(Number(t.amount)),
          date: t.date,
          salaryYm: t.salaryYm || ymOf(t.date),
          accountName: (t.accountId && m.acc.get(t.accountId)?.name) || null,
          // Заметка без служебного маркера — то, что ввёл пользователь.
          note: salaryNoteOf(t.comment),
        };
      })
      .filter(r => r.salaryYm >= minYm)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // История — это не только банковские операции. В старой июньской
    // ведомости авансы/бонусы и зафиксированный оклад хранились в снимке,
    // а в журнал попадала лишь финальная выплата (например 4 000 из оклада
    // 5 000 после аванса 1 000). Возвращаем начисления отдельно: пользователь
    // видит правильный оклад, а реальные операции не переписываются и не
    // задваиваются.
    const snapshotMap = e.salarySnapshots || {};
    const periodYms = new Set<string>([
      ...rows.map(r => r.salaryYm),
      ...Object.keys(snapshotMap).filter(ym => ym >= minYm),
    ]);
    const periods = [...periodYms]
      .filter(ym => workedInFinanceMonth(e, ym))
      .sort((a, b) => b.localeCompare(a))
      .map(ym => {
        const snapshot = snapshotMap[ym];
        const periodRows = rows.filter(r => r.salaryYm === ym);
        const txAdvance = r2(periodRows.filter(r => r.kind === 'advance').reduce((s, r) => s + r.amount, 0));
        const txBonus = r2(periodRows.filter(r => r.kind === 'bonus').reduce((s, r) => s + r.amount, 0));
        const salary = snapshot ? r2(Number(snapshot.salary) || 0) : salaryForMonth(e, ym);
        const advance = snapshot ? r2(Number(snapshot.advance) || 0) : txAdvance;
        const bonus = snapshot ? r2(Number(snapshot.bonus) || 0) : txBonus;
        const fine = snapshot ? r2(Number(snapshot.fine) || 0) : fineOf(e, ym);
        return {
          ym, salary, advance, bonus, fine,
          accrued: r2(Math.max(0, salary + bonus - fine)),
          paidByOperations: r2(periodRows.reduce((s, r) => s + r.amount, 0)),
          frozen: !!snapshot,
        };
      });

    const periodSum = (key: 'salary' | 'advance' | 'bonus' | 'fine' | 'accrued') =>
      r2(periods.reduce((s, period) => s + Number(period[key]), 0));
    return {
      employeeId: id,
      name: e.name,
      rows,
      periods,
      totals: {
        advance: periodSum('advance'),
        bonus: periodSum('bonus'),
        fine: periodSum('fine'),
        salary: periodSum('salary'),
        accrued: periodSum('accrued'),
        paidByOperations: r2(rows.reduce((s, r) => s + r.amount, 0)),
        all: periodSum('accrued'),
      },
    };
  }

  async setEmployeeAdvance(id: string, dto: { ym?: string; amount?: any }) {
    return this.setEmployeeMonthField(id, 'advances', dto, 'Аванс');
  }

  /** Штраф за месяц — вычитается из «к выплате». */
  async setEmployeeFine(id: string, dto: { ym?: string; amount?: any }) {
    return this.setEmployeeMonthField(id, 'fines', dto, 'Штраф');
  }

  private async setEmployeeMonthField(
    id: string, field: 'bonuses' | 'advances' | 'fines',
    dto: { ym?: string; amount?: any }, label: string,
  ) {
    const e = await this.empRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const ym = dto.ym || currentYm();
    // Выплаченный месяц заморожен — менять его суммы нельзя (месяцы независимы).
    if (snapOf(e, ym)) throw new BadRequestException('Месяц уже выплачен и зафиксирован — правки недоступны');
    const amount = r2(Number(dto.amount) || 0);
    if (amount < 0) throw new BadRequestException(`${label} не может быть отрицательным`);
    const map = { ...((e as any)[field] || {}) };
    if (amount > 0) map[ym] = amount;
    else delete map[ym];
    (e as any)[field] = Object.keys(map).length ? map : null;
    return this.empRepo.save(e);
  }

  // Подписки/аренда
  listSubscriptions() { return this.subRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } }); }
  /** День оплаты 1..31 либо null (сброс/не задан). */
  private normDueDay(v: any): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  }
  async createSubscription(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = await this.subRepo.count();
    return this.subRepo.save(this.subRepo.create({
      name: dto.name.trim(), kind: dto.kind === 'rent' ? 'rent' : 'subscription',
      amount: Number(dto.amount) || 0, active: dto.active !== false,
      dueDay: this.normDueDay(dto.dueDay), position,
    }));
  }
  async updateSubscription(id: string, dto: any) {
    const s = await this.subRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Позиция не найдена');
    if (dto.name !== undefined) s.name = String(dto.name).trim();
    if (dto.kind !== undefined) s.kind = dto.kind === 'rent' ? 'rent' : 'subscription';
    if (dto.amount !== undefined) s.amount = Number(dto.amount) || 0;
    if (dto.active !== undefined) s.active = !!dto.active;
    if (dto.dueDay !== undefined) s.dueDay = this.normDueDay(dto.dueDay);
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

  // ─── Инвентарь (оборудование + амортизация) ──────────────────────
  /** Полных месяцев эксплуатации от даты покупки до сегодня (не меньше 0). */
  private assetMonthsElapsed(purchaseDate: string | null): number {
    if (!purchaseDate || purchaseDate.length < 10) return 0;
    const today = todayISO();
    if (purchaseDate >= today) return 0;
    const [py, pm, pd] = purchaseDate.slice(0, 10).split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    let months = (ty - py) * 12 + (tm - pm);
    if (td < pd) months -= 1; // неполный месяц не считаем
    return Math.max(0, months);
  }

  /** Расчёт линейной амортизации: цена равными долями за срок службы.
   *  Для списанных/проданных остаточную стоимость считаем нулевой. */
  private decorateAsset(a: FinanceAsset) {
    const price = Number(a.price) || 0;
    const life = Number(a.serviceMonths) || 0;
    const monthlyDep = life > 0 ? r2(price / life) : 0;
    const elapsed = this.assetMonthsElapsed(a.purchaseDate);
    const depreciated = life > 0 ? r2(Math.min(price, monthlyDep * Math.min(elapsed, life))) : 0;
    const residualRaw = life > 0 ? r2(Math.max(0, price - depreciated)) : price;
    const active = a.status === 'in_use' || a.status === 'repair';
    return {
      ...a, price,
      monthlyDep, depreciated: active ? depreciated : price,
      residual: active ? residualRaw : 0,
      monthsElapsed: elapsed,
      wornOut: life > 0 && elapsed >= life,
    };
  }

  async listAssets() {
    const rows = await this.assetRepo.find({ order: { position: 'ASC', createdAt: 'ASC' } });
    return rows.map(a => this.decorateAsset(a));
  }

  async createAsset(dto: any) {
    if (!dto.name?.trim()) throw new BadRequestException('Название обязательно');
    const position = await this.assetRepo.count();
    const saved = await this.assetRepo.save(this.assetRepo.create({
      name: dto.name.trim(), category: dto.category?.trim() || null,
      purchaseDate: dto.purchaseDate || null, price: r2(Number(dto.price) || 0),
      serviceMonths: Math.max(0, Number(dto.serviceMonths) || 0),
      status: ['in_use', 'repair', 'written_off', 'sold'].includes(dto.status) ? dto.status : 'in_use',
      assignee: dto.assignee?.trim() || null, serial: dto.serial?.trim() || null,
      warrantyUntil: dto.warrantyUntil || null, note: dto.note?.trim() || null, position,
    }));
    return this.decorateAsset(saved);
  }

  async updateAsset(id: string, dto: any) {
    const a = await this.assetRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Позиция инвентаря не найдена');
    if (dto.name !== undefined) a.name = String(dto.name).trim();
    if (dto.category !== undefined) a.category = dto.category?.trim() || null;
    if (dto.purchaseDate !== undefined) a.purchaseDate = dto.purchaseDate || null;
    if (dto.price !== undefined) a.price = r2(Number(dto.price) || 0);
    if (dto.serviceMonths !== undefined) a.serviceMonths = Math.max(0, Number(dto.serviceMonths) || 0);
    if (dto.status !== undefined && ['in_use', 'repair', 'written_off', 'sold'].includes(dto.status)) a.status = dto.status;
    if (dto.assignee !== undefined) a.assignee = dto.assignee?.trim() || null;
    if (dto.serial !== undefined) a.serial = dto.serial?.trim() || null;
    if (dto.warrantyUntil !== undefined) a.warrantyUntil = dto.warrantyUntil || null;
    if (dto.note !== undefined) a.note = dto.note?.trim() || null;
    return this.decorateAsset(await this.assetRepo.save(a));
  }

  async removeAsset(id: string) { await this.assetRepo.delete(id); return { ok: true }; }

  // ─── Резервная копия / сброс ─────────────────────────────────────
  private async exportAllWithManager(em: EntityManager) {
    const [accounts, categories, projects, employees, subscriptions, debts, plannedPayments, transactions, assets, forecastAdjustments] = await Promise.all([
      em.getRepository(FinanceAccount).find(),
      em.getRepository(FinanceCategory).find(),
      em.getRepository(FinanceProject).find(),
      em.getRepository(FinanceEmployee).find(),
      em.getRepository(FinanceSubscription).find(),
      em.getRepository(FinanceDebt).find(),
      em.getRepository(FinancePlannedPayment).find(),
      em.getRepository(FinanceTransaction).find(),
      em.getRepository(FinanceAsset).find(),
      em.getRepository(FinanceForecastAdjustment).find(),
    ]);
    return {
      version: 2, exportedAt: new Date().toISOString(),
      accounts, categories, projects, employees, subscriptions, debts,
      plannedPayments, transactions, assets, forecastAdjustments,
    };
  }

  async exportAll() {
    // Все таблицы читаются из одного repeatable-read snapshot: параллельная
    // оплата не может попасть в экспорт наполовину (план без проводки).
    return this.ds.transaction('REPEATABLE READ', em => this.exportAllWithManager(em));
  }

  private backupStats(data: Awaited<ReturnType<FinanceService['exportAllWithManager']>>) {
    return {
      transactions: data.transactions.length, plannedPayments: data.plannedPayments.length,
      projects: data.projects.length, employees: data.employees.length,
      accounts: data.accounts.length, debts: data.debts.length,
      subscriptions: data.subscriptions.length, assets: data.assets.length,
      forecastAdjustments: data.forecastAdjustments.length,
    };
  }

  /** Блокирует финансовые таблицы на время destructive-операции. Уже
   * начавшиеся записи сначала коммитятся и попадут в safety snapshot; новые
   * ждут завершения импорта/сброса и не могут исчезнуть между снимком и DELETE. */
  private async lockFinanceTables(em: EntityManager) {
    await em.query(`
      LOCK TABLE
        finance_planned_payments,
        finance_transactions,
        finance_forecast_adjustments,
        finance_assets,
        finance_debts,
        finance_subscriptions,
        finance_employees,
        finance_projects,
        finance_categories,
        finance_accounts
      IN ACCESS EXCLUSIVE MODE
    `);
  }

  private async saveBackupWithManager(
    em: EntityManager,
    kind: 'pre_restore' | 'pre_import' | 'pre_reset',
    data: Awaited<ReturnType<FinanceService['exportAllWithManager']>>,
  ) {
    const repo = em.getRepository(FinanceBackup);
    return repo.save(repo.create({ kind, stats: this.backupStats(data), data }));
  }

  private async replaceFinanceData(em: EntityManager, data: any) {
    const txRepo = em.getRepository(FinanceTransaction);
    const ppRepo = em.getRepository(FinancePlannedPayment);
    const assetRepo = em.getRepository(FinanceAsset);
    const forecastAdjRepo = em.getRepository(FinanceForecastAdjustment);
    const debtRepo = em.getRepository(FinanceDebt);
    const subRepo = em.getRepository(FinanceSubscription);
    const empRepo = em.getRepository(FinanceEmployee);
    const projRepo = em.getRepository(FinanceProject);
    const catRepo = em.getRepository(FinanceCategory);
    const accRepo = em.getRepository(FinanceAccount);
    for (const repo of [txRepo, ppRepo, forecastAdjRepo, assetRepo, debtRepo, subRepo, empRepo, projRepo, catRepo, accRepo]) {
      await repo.createQueryBuilder().delete().execute();
    }
    const save = async (repo: Repository<any>, rows: any[]) => {
      if (rows.length) await repo.save(rows, { chunk: 500 });
    };
    await save(accRepo, data.accounts);
    await save(catRepo, data.categories);
    await save(projRepo, data.projects);
    await save(empRepo, data.employees);
    await save(subRepo, data.subscriptions);
    await save(debtRepo, data.debts);
    await save(ppRepo, data.plannedPayments);
    await save(txRepo, data.transactions);
    await save(assetRepo, data.assets || []);
    await save(forecastAdjRepo, data.forecastAdjustments || []);
  }

  // ─── Снимки данных (автобэкап) ───────────────────────────────────
  /** Ежедневный снимок в 02:00 Душанбе — страховка от случайной порчи данных
   *  (инлайн-правки журнала, неудачный импорт). */
  @Cron('0 2 * * *', { timeZone: 'Asia/Dushanbe' })
  async autoBackup() {
    try {
      await this.createBackupSnapshot('auto');
    } catch (e: any) {
      this.logger.warn(`finance auto-backup failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  /** Держим последние 30 авто-снимков и 10 ручных/предвосстановительных. */
  private async pruneBackups() {
    const all = await this.backupRepo.find({ order: { createdAt: 'DESC' } as any, select: ['id', 'kind', 'createdAt'] as any });
    const over = (kinds: string[], keep: number) =>
      all.filter(b => kinds.includes(b.kind)).slice(keep).map(b => b.id);
    const ids = [...over(['auto'], 30), ...over(['manual', 'pre_restore', 'pre_import', 'pre_reset'], 10)];
    if (ids.length) await this.backupRepo.delete(ids);
  }

  private async safePruneBackups() {
    try {
      await this.pruneBackups();
    } catch (e: any) {
      // Основная операция уже могла успешно закоммититься. Ошибка служебной
      // ротации не должна провоцировать пользователя повторять import/reset.
      this.logger.warn(`finance backup pruning failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  async createBackupSnapshot(kind: 'auto' | 'manual' | 'pre_restore' | 'pre_import' | 'pre_reset' = 'manual') {
    const data = await this.exportAll();
    const stats = this.backupStats(data);
    const saved = await this.backupRepo.save(this.backupRepo.create({ kind, stats, data }));
    await this.safePruneBackups();
    return { id: saved.id, kind: saved.kind, createdAt: saved.createdAt, stats };
  }

  /** Список снимков без тяжёлого поля data. */
  async listBackups() {
    const rows = await this.backupRepo.find({
      order: { createdAt: 'DESC' } as any,
      select: ['id', 'kind', 'stats', 'createdAt'] as any,
    });
    return rows;
  }

  async getBackup(id: string) {
    const b = await this.backupRepo.findOne({ where: { id } });
    if (!b) throw new NotFoundException('Снимок не найден');
    return b;
  }

  /** Восстановить данные из снимка; текущее состояние прежде сохраняется
   *  отдельным снимком pre_restore — восстановление всегда обратимо. */
  async restoreBackup(id: string) {
    const b = await this.getBackup(id);
    return this.importAll(b.data, 'pre_restore');
  }

  /** Полная проверка файла выполняется ДО снимка и удаления данных. */
  private validateImport(data: any) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new BadRequestException('Неверный формат файла');
    if (data.version != null && ![1, 2].includes(Number(data.version)))
      throw new BadRequestException(`Версия резервной копии ${data.version} не поддерживается`);
    const required = ['accounts', 'categories', 'projects', 'employees', 'subscriptions', 'debts', 'plannedPayments', 'transactions'];
    for (const key of required) {
      if (!Array.isArray(data[key])) throw new BadRequestException(`В резервной копии отсутствует раздел «${key}»`);
    }
    if (data.accounts.length === 0 || data.categories.length === 0)
      throw new BadRequestException('Резервная копия должна содержать счета и категории');
    if (data.assets != null && !Array.isArray(data.assets))
      throw new BadRequestException('Раздел «assets» должен быть массивом');
    if (data.forecastAdjustments != null && !Array.isArray(data.forecastAdjustments))
      throw new BadRequestException('Раздел «forecastAdjustments» должен быть массивом');
    const ids = (rows: any[], label: string) => {
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !row.id) throw new BadRequestException(`${label}: запись без id`);
        if (seen.has(row.id)) throw new BadRequestException(`${label}: повторяющийся id ${row.id}`);
        seen.add(row.id);
      }
      return seen;
    };
    ids(data.accounts, 'Счета');
    ids(data.categories, 'Категории');
    ids(data.projects, 'Проекты');
    ids(data.employees, 'Сотрудники');
    ids(data.debts, 'Долги');
    ids(data.subscriptions, 'Подписки');
    ids(data.plannedPayments, 'Плановые оплаты');
    ids(data.transactions, 'Транзакции');
    if (data.assets?.length) ids(data.assets, 'Инвентарь');
    for (const tx of data.transactions) {
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException(`Транзакция ${tx.id}: неверная сумма`);
    }
  }

  /** Приводит старые backup-версии к текущей модели до записи. Иначе v1
   * с legacy account восстановится «успешно», но деньги появятся на счетах
   * только после рестарта и runtime-бэкфилла. */
  private normalizeImportData(data: any) {
    const normalized = JSON.parse(JSON.stringify(data));
    const rawVersion = normalized.version == null ? 1 : Number(normalized.version);
    if (![1, 2].includes(rawVersion)) {
      throw new BadRequestException(`Версия резервной копии ${normalized.version} не поддерживается`);
    }
    const legacyV1 = rawVersion === 1;
    if (legacyV1 && !Array.isArray(normalized.plannedPayments)) {
      normalized.plannedPayments = [];
    }
    const accountByKey = new Map<string, string>(
      (Array.isArray(normalized.accounts) ? normalized.accounts : [])
        .filter((account: any) => account?.key && account?.id)
        .map((account: any) => [String(account.key), String(account.id)]),
    );
    if (Array.isArray(normalized.transactions)) normalized.transactions = normalized.transactions.map((tx: any) => {
      if (!tx.accountId && tx.account && accountByKey.has(String(tx.account))) {
        tx.accountId = accountByKey.get(String(tx.account));
      }
      return tx;
    });
    if (Array.isArray(normalized.projects)) normalized.projects = normalized.projects.map((project: any) => {
      if (project.archived || project.status === 'archived') {
        project.archived = true;
        project.status = 'archived';
      } else {
        project.archived = false;
      }
      return project;
    });
    if (Array.isArray(normalized.employees)) normalized.employees = normalized.employees.map((employee: any) => {
      if (employee.status === 'inactive') employee.status = 'fired';
      if (!employee.salaryHistory || !Object.keys(employee.salaryHistory).length) {
        const effectiveYm = ymOf(employee.hireDate || employee.createdAt || todayISO());
        employee.salaryHistory = { [effectiveYm]: r2(employee.salary) };
      }
      return employee;
    });
    normalized.version = 2;
    normalized.assets ||= [];
    normalized.forecastAdjustments ||= [];
    return normalized;
  }

  /** Импорт атомарный: при любой ошибке PostgreSQL откатывает очистку и
   *  все вставки. Перед обычным импортом дополнительно сохраняем pre_import. */
  async importAll(
    data: any,
    safetyKind: false | 'pre_import' | 'pre_restore' = 'pre_import',
  ) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Неверный формат файла');
    }
    const normalized = this.normalizeImportData(data);
    this.validateImport(normalized);
    let safetyBackupId: string | null = null;
    await this.ds.transaction('SERIALIZABLE', async em => {
      await this.lockFinanceTables(em);
      if (safetyKind) {
        const before = await this.exportAllWithManager(em);
        safetyBackupId = (await this.saveBackupWithManager(em, safetyKind, before)).id;
      }
      await this.replaceFinanceData(em, normalized);
    });
    if (safetyKind) await this.safePruneBackups();
    return { ok: true, safetyBackupId };
  }

  /** Полный сброс финансовых данных. reseed=true → пересоздаёт дефолты. */
  async resetAll(reseed = true) {
    let safetyBackupId: string | null = null;
    await this.ds.transaction('SERIALIZABLE', async em => {
      await this.lockFinanceTables(em);
      const before = await this.exportAllWithManager(em);
      safetyBackupId = (await this.saveBackupWithManager(em, 'pre_reset', before)).id;
      await this.replaceFinanceData(em, {
        accounts: [], categories: [], projects: [], employees: [],
        subscriptions: [], debts: [], plannedPayments: [], transactions: [],
        assets: [], forecastAdjustments: [],
      });
      if (reseed) {
        const accRepo = em.getRepository(FinanceAccount);
        const catRepo = em.getRepository(FinanceCategory);
        await accRepo.save(DEFAULT_ACCOUNTS.map(a => accRepo.create({ ...a, startBalance: 0 })));
        await catRepo.save(DEFAULT_CATEGORIES.map(c => catRepo.create(c)));
      }
    });
    await this.safePruneBackups();
    return { ok: true, safetyBackupId };
  }
}
