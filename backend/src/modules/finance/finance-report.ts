// Финансовый отчёт в Excel (06.11.2026): вся история финансов одним файлом,
// 13 листов — для финансиста, который ищет «дыры». Макет утверждён владельцем.
//
// Здесь только раскладка по листам, оформление и проверки. Данные собирает
// FinanceService.financeReport() — теми же правилами, что и экраны CRM, чтобы
// цифры в файле совпадали с тем, что видно в «Финансах».
import * as ExcelJS from 'exceljs';

// ─── Входные данные ──────────────────────────────────────────────────────

export type ReportTxStatus = 'posted' | 'future' | 'pending' | 'cancelled';

export interface ReportTx {
  id: string;
  /** Номер строки в листе «Операции» (по дате, затем по времени внесения). */
  no: number;
  date: string;               // YYYY-MM-DD
  type: 'income' | 'expense' | 'transfer' | 'saving' | string;
  status: ReportTxStatus;
  amount: number;
  accountId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  /** Старые накопления: пополнение одного счёта без «откуда». */
  legacySaving: boolean;
  affectsBalance: boolean;
  accountName: string | null;  // для дохода/расхода
  fromName: string | null;     // для перевода/накопления
  toName: string | null;
  categoryId: string | null;
  category: string | null;
  groupKey: string | null;     // salary | rent_subs | debts | installments | transport | other | направление дохода
  groupLabel: string | null;
  directionLabel: string | null;
  projectId: string | null;
  project: string | null;
  employeeId: string | null;
  employee: string | null;
  recipient: string | null;
  salaryYm: string | null;
  debtId: string | null;
  debt: string | null;
  subscriptionId: string | null;
  subscription: string | null;
  counterparty: string | null;
  comment: string | null;
  description: string | null;
  paymentMethod: string | null;
  source: string | null;       // null — внесено в CRM
  createdBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ReportAccount {
  id: string; name: string; kind: string; startBalance: number; archived: boolean;
}

export interface ReportPlan {
  id: string;
  project: string; direction: string | null; manager: string | null; tariff: number | null;
  projectStatus: string; earning: boolean;
  ym: string; partNo: number; amount: number; dueDate: string | null;
  status: 'expected' | 'received' | string;
  receivedTx: { no: number; date: string; amount: number; account: string | null } | null;
  receivedTxId: string | null;
  auto: boolean;
}

export interface ReportPayrollRow {
  ym: string; employee: string; role: string | null;
  salary: number; bonus: number; fine: number; vacation: number; installment: number;
  advance: number; paid: number; toPay: number; frozen: boolean;
  periodStatus: string | null; closedAt: Date | null; paidAt: string | null;
}

export interface ReportEmployee {
  name: string; role: string | null; status: string | null; hireDate: string | null; terminationDate: string | null;
  salaryNow: number; salaryHistory: Record<string, number>; hasCrmUser: boolean; category: string | null;
}

export interface ReportDebt {
  id: string; name: string; counterparty: string | null; total: number; paidBefore: number;
  paidInCrm: number; remaining: number; dueDate: string | null; note: string | null; createdAt: Date | null;
  tranches: Array<{ date: string; amount: number; received: boolean }>;
}

export interface ReportBank {
  name: string; bank: string | null; total: number; paidBefore: number; monthly: number; dueDay: number | null;
  paid: number; remaining: number; done: boolean;
  next: { date: string; amount: number; overdue: boolean } | null;
  plan: Array<{ date: string; amount: number; paid: boolean; overdue: boolean }>;
  note: string | null;
}

export interface ReportInstallment {
  employee: string; name: string; method: string; total: number; monthly: number; startYm: string | null;
  paid: number; remaining: number; done: boolean;
  next: { date: string; amount: number } | null;
  overdue: { amount: number; count: number; since: string } | null;
  schedule: Array<{ ym: string; date: string; amount: number; outstanding: number; status: string }>;
}

export interface ReportSubscription {
  id: string; name: string; kind: string | null; amount: number; dueDay: number | null; active: boolean;
  start: string | null; end: string | null;
  marks: Array<{ ym: string; date: string | null }>;
}

export interface ReportAsset {
  name: string; category: string | null; purchaseDate: string | null; price: number; serviceMonths: number;
  monthlyDep: number; depreciated: number; residual: number; status: string | null; assignee: string | null;
  serial: string | null; warrantyUntil: string | null; note: string | null; wornOut: boolean;
}

export interface ReportActivity {
  at: Date; user: string | null; action: string; route: string | null;
  object: string | null; before: string | null; after: string | null; input: string | null;
}

export interface FinanceReportInput {
  exportedAt: Date;
  exportedBy: string | null;
  today: string;               // YYYY-MM-DD, Душанбе
  thresholds: { lateDays: number; bigExpense: number };
  accounts: ReportAccount[];
  txs: ReportTx[];
  plans: ReportPlan[];
  payroll: ReportPayrollRow[];
  employees: ReportEmployee[];
  debts: ReportDebt[];
  banks: ReportBank[];
  installments: ReportInstallment[];
  subscriptions: ReportSubscription[];
  assets: ReportAsset[];
  activity: ReportActivity[];
}

// ─── Подписи ─────────────────────────────────────────────────────────────

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const TYPE_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' };
const STATUS_LABEL: Record<ReportTxStatus, string> = {
  posted: 'Проведено', future: 'Запланировано', pending: 'Ожидание', cancelled: 'Отменено',
};
const SEVERITY_LABEL = { critical: 'Критично', warning: 'Проверить', info: 'Справка' } as const;
type Severity = keyof typeof SEVERITY_LABEL;

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthsBetween = (fromYm: string, toYm: string) => {
  const out: string[] = [];
  for (let ym = fromYm; ym <= toYm && out.length < 600; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
};
const lastDayOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const fmtMoney = (n: number) => {
  const v = r2(n);
  const [int, frac] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${frac === '00' ? '' : ',' + frac} с.`;
};
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
};
/** Дата 'YYYY-MM-DD' → Date для Excel (полночь UTC — Excel покажет этот же день). */
const xDate = (iso: string | null | undefined): Date | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return null;
  const s = String(iso);
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
};
/** Момент времени → время Душанбе (UTC+5) для ячейки Excel. */
const xLocal = (d: Date | null | undefined): Date | null => (d ? new Date(new Date(d).getTime() + 5 * 3600_000) : null);
const localIso = (d: Date | null | undefined) => (d ? xLocal(d)!.toISOString().slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000);

// ─── Журнал изменений: поля человеческими словами ────────────────────────

export const REPORT_TYPE_LABEL = TYPE_LABEL;
export const reportMoney = (n: number) => fmtMoney(n);

const DETAIL_LABELS: Record<string, string> = {
  amount: 'Сумма', date: 'Дата операции', ym: 'Месяц', comment: 'Комментарий', type: 'Тип', name: 'Название',
  employeeId: 'Сотрудник', projectId: 'Проект', accountId: 'Счёт', fromAccountId: 'Со счёта', toAccountId: 'На счёт',
  categoryId: 'Категория', debtId: 'Долг', subscriptionId: 'Подписка', assetId: 'Инвентарь', salary: 'Оклад',
  salaryYm: 'Месяц ЗП', role: 'Должность', status: 'Статус', kind: 'Вид', tariff: 'Тариф', dueDate: 'Срок',
  contractDate: 'Дата договора', hireDate: 'Дата приёма', terminationDate: 'Дата увольнения', archived: 'В архиве',
  active: 'Активно', affectsBalance: 'Влияет на баланс', note: 'Примечание', partNo: 'Часть оплаты',
  totalAmount: 'Сумма долга', monthlyPayment: 'Платёж в месяц', startBalance: 'Начальный баланс',
  direction: 'Направление', category: 'Группа', price: 'Стоимость', assignee: 'Ответственный',
  purchaseDate: 'Дата покупки', warrantyUntil: 'Гарантия до', startYm: 'С месяца', endYm: 'До месяца',
  paidBefore: 'Отдали раньше', counterparty: 'Контрагент', recipientId: 'Получатель', monthlyAmount: 'В месяц',
  endDate: 'Дата окончания', dueDay: 'День оплаты', serial: 'Серийный номер', method: 'Способ',
};
const MONEY_KEYS = new Set(['amount', 'salary', 'tariff', 'totalAmount', 'monthlyPayment', 'startBalance', 'price', 'paidBefore', 'monthlyAmount']);
const DATE_KEYS = new Set(['date', 'dueDate', 'contractDate', 'hireDate', 'terminationDate', 'purchaseDate', 'warrantyUntil', 'endDate']);
const YM_KEYS = new Set(['ym', 'salaryYm', 'startYm', 'endYm']);
const SKIP_KEYS = new Set(['createdAt', 'updatedAt', 'createdBy', 'createdById', 'position', 'id', 'objectId']);
const STATUS_WORDS: Record<string, string> = {
  active: 'Активный', paused: 'На паузе', lead: 'Лид', done: 'Завершён', archived: 'В архиве', expected: 'Ожидается',
  received: 'Получено', fired: 'Уволен', completed: 'Проведено', cancelled: 'Отменено', pending: 'Ожидание',
  in_use: 'В работе', repair: 'В ремонте', written_off: 'Списано', sold: 'Продано',
};

/** Объект «было/стало» из журнала → «Сумма: 6 500 с.; Счёт: Alif». */
export function describeReportFields(obj: any, refs: Record<string, Map<string, string>>): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEYS.has(k) || v === undefined) continue;
    let val: string;
    if (v === null || v === '') val = '—';
    else if (refs[k] && typeof v === 'string') val = refs[k].get(v) || `…${v.slice(-6)}`;
    else if (MONEY_KEYS.has(k) && !Number.isNaN(Number(v))) val = fmtMoney(Number(v));
    else if (DATE_KEYS.has(k)) val = fmtDate(String(v));
    else if (YM_KEYS.has(k) && /^\d{4}-\d{2}$/.test(String(v))) val = monthLabel(String(v));
    else if (k === 'type') val = TYPE_LABEL[String(v)] || String(v);
    else if (k === 'status') val = STATUS_WORDS[String(v)] || String(v);
    else if (typeof v === 'boolean') val = v ? 'да' : 'нет';
    else if (typeof v === 'object') { try { val = JSON.stringify(v).slice(0, 120); } catch { val = '…'; } }
    else val = String(v);
    parts.push(`${DETAIL_LABELS[k] || k}: ${val}`);
  }
  const text = parts.join('; ');
  return text ? (text.length > 600 ? `${text.slice(0, 600)}…` : text) : null;
}

// ─── Оформление ──────────────────────────────────────────────────────────

const C = {
  headFill: 'FF2F3E55', headInk: 'FFFFFFFF', band: 'FFF6F8FB', grid: 'FFE1E5EB',
  totalFill: 'FFE9EDF3', totalLine: 'FF9AA4B4',
  bad: 'FFFDE3DF', badInk: 'FFA12F22', warn: 'FFFFF1CF', warnInk: 'FF8A5A00',
  ok: 'FFE2F4E8', okInk: 'FF1D6B43', gray: 'FF8B929E', mute: 'FF6B7380', title: 'FF1C2230', link: 'FF2F5DA8',
};
const FMT = {
  money: '#,##0.00',
  signed: '#,##0.00;[Red]-#,##0.00',
  int: '0',
  date: 'dd.mm.yyyy',
  datetime: 'dd.mm.yyyy hh:mm',
  percent: '0%',
};

type ColType = 'text' | 'money' | 'signed' | 'int' | 'date' | 'datetime' | 'percent' | 'wrap';
interface Col { header: string; key: string; width: number; type?: ColType; total?: 'sum' | 'label' }
type RowTone = 'bad' | 'warn' | 'ok' | 'gray' | null;
type Row = Record<string, any> & { _tone?: RowTone; _links?: Record<string, string> };

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb: string): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });

/** Заголовок листа и пояснение над таблицей. */
function sheetTitle(ws: ExcelJS.Worksheet, row: number, title: string, note?: string): number {
  const t = ws.getCell(row, 1);
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: C.title } };
  if (note) {
    const n = ws.getCell(row + 1, 1);
    n.value = note;
    n.font = { size: 10, color: { argb: C.mute }, italic: true };
    return row + 2;
  }
  return row + 1;
}

/** Таблица: шапка, строки с полосами и цветами, итог формулами.
 *  Возвращает номер строки после таблицы. */
function table(ws: ExcelJS.Worksheet, startRow: number, cols: Col[], rows: Row[], opts: {
  freeze?: boolean; filter?: boolean; totalLabel?: string;
} = {}): number {
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (!col.width || (col.width as number) < c.width) col.width = c.width;
  });
  const head = ws.getRow(startRow);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: C.headInk }, size: 10 };
    cell.fill = fill(C.headFill);
    cell.alignment = { vertical: 'middle', horizontal: c.type && c.type !== 'text' && c.type !== 'wrap' ? 'right' : 'left', wrapText: true };
    cell.border = { right: thin('FF415170') };
  });
  head.height = 30;

  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      let v = r[c.key];
      if (v === undefined || v === '') v = null;
      if (v != null && (c.type === 'date')) v = v instanceof Date ? v : xDate(String(v));
      if (v != null && (c.type === 'money' || c.type === 'signed' || c.type === 'int' || c.type === 'percent') && typeof v !== 'object') v = Number(v);
      const link = r._links?.[c.key];
      cell.value = link && v != null ? { text: String(v), hyperlink: link } : v;
      if (c.type === 'money') cell.numFmt = FMT.money;
      else if (c.type === 'signed') cell.numFmt = FMT.signed;
      else if (c.type === 'int') cell.numFmt = FMT.int;
      else if (c.type === 'date') cell.numFmt = FMT.date;
      else if (c.type === 'datetime') cell.numFmt = FMT.datetime;
      else if (c.type === 'percent') cell.numFmt = FMT.percent;
      cell.alignment = { vertical: 'top', wrapText: c.type === 'wrap', horizontal: c.type && c.type !== 'text' && c.type !== 'wrap' ? 'right' : 'left' };
      cell.border = { bottom: thin(C.grid), right: thin(C.grid) };
      const tone = r._tone;
      if (tone === 'bad') { cell.fill = fill(C.bad); cell.font = { color: { argb: C.badInk } }; }
      else if (tone === 'warn') { cell.fill = fill(C.warn); cell.font = { color: { argb: C.warnInk } }; }
      else if (tone === 'ok') { cell.fill = fill(C.ok); cell.font = { color: { argb: C.okInk } }; }
      else if (tone === 'gray') { cell.font = { color: { argb: C.gray }, italic: true }; if (ri % 2) cell.fill = fill(C.band); }
      else if (ri % 2) cell.fill = fill(C.band);
      if (link) cell.font = { ...(cell.font || {}), color: { argb: C.link }, underline: true };
    });
  });

  let end = startRow + 1 + rows.length;
  if (opts.totalLabel && rows.length) {
    const tr = ws.getRow(end);
    cols.forEach((c, ci) => {
      const cell = tr.getCell(ci + 1);
      if (ci === 0) cell.value = opts.totalLabel;
      else if (c.total === 'sum') {
        const letter = ws.getColumn(ci + 1).letter;
        const sum = r2(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0));
        cell.value = { formula: `SUM(${letter}${startRow + 1}:${letter}${end - 1})`, result: sum } as any;
        cell.numFmt = c.type === 'int' ? FMT.int : c.type === 'signed' ? FMT.signed : FMT.money;
      }
      cell.font = { bold: true };
      cell.fill = fill(C.totalFill);
      cell.border = { top: { style: 'medium', color: { argb: C.totalLine } } };
      cell.alignment = { horizontal: ci === 0 ? 'left' : 'right' };
    });
    end += 1;
  }
  if (opts.filter && rows.length) {
    ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: cols.length } };
  }
  if (opts.freeze) ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: 0 }];
  return end + 1;
}

function newSheet(wb: ExcelJS.Workbook, name: string, tab?: string): ExcelJS.Worksheet {
  return wb.addWorksheet(name, {
    properties: { tabColor: tab ? { argb: tab } : undefined, defaultRowHeight: 16 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
}

// ─── Расчёты для листов ──────────────────────────────────────────────────

interface Finding {
  severity: Severity; check: string; date: string | null; period?: string | null; amount: number | null;
  what: string; where: string; link?: string;
}

const opsLink = (no: number) => `#'Операции'!A${no + 3}`; // шапка листа — 3-я строка

/** Остатки счетов по дням: минимум, дни в минусе, конец каждого месяца. */
function accountDays(input: FinanceReportInput, months: string[]) {
  const posted = input.txs.filter(t => t.status === 'posted' && t.affectsBalance);
  const first = months[0] ? `${months[0]}-01` : input.today;
  const delta = new Map<string, Map<string, number>>(); // account → date → изменение
  const add = (acc: string | null, date: string, v: number) => {
    if (!acc) return;
    if (!delta.has(acc)) delta.set(acc, new Map());
    const m = delta.get(acc)!;
    m.set(date, (m.get(date) || 0) + v);
  };
  for (const t of posted) {
    const d = t.date < first ? first : t.date;
    if (t.type === 'income') add(t.accountId, d, t.amount);
    else if (t.type === 'expense') add(t.accountId, d, -t.amount);
    else if (t.legacySaving) add(t.accountId, d, t.amount);
    else if (t.type === 'transfer' || t.type === 'saving') { add(t.fromAccountId, d, -t.amount); add(t.toAccountId, d, t.amount); }
  }
  const result = new Map<string, {
    min: number; minDate: string | null; negDays: number; monthEnd: Record<string, number>; current: number;
    negPeriods: Array<{ from: string; to: string | null; min: number; days: number }>;
  }>();
  const total = daysBetween(first, input.today);
  for (const a of input.accounts) {
    const dm = delta.get(a.id) || new Map<string, number>();
    let bal = r2(a.startBalance);
    let min = Infinity, minDate: string | null = null, negDays = 0;
    const monthEnd: Record<string, number> = {};
    const negPeriods: Array<{ from: string; to: string | null; min: number; days: number }> = [];
    let open: { from: string; min: number; days: number } | null = null;
    for (let i = 0; i <= total; i++) {
      const day = new Date(Date.parse(first + 'T00:00:00Z') + i * 86400_000).toISOString().slice(0, 10);
      bal = r2(bal + (dm.get(day) || 0));
      if (bal < min) { min = bal; minDate = day; }
      if (bal < -0.004) {
        negDays++;
        if (!open) open = { from: day, min: bal, days: 0 };
        open.days++; if (bal < open.min) open.min = bal;
      } else if (open) {
        const prev = new Date(Date.parse(day + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
        negPeriods.push({ ...open, to: prev }); open = null;
      }
      const ym = day.slice(0, 7);
      if (day === lastDayOf(ym) || day === input.today) monthEnd[ym] = bal;
    }
    if (open) negPeriods.push({ ...open, to: null });
    result.set(a.id, { min: min === Infinity ? bal : min, minDate, negDays, monthEnd, current: bal, negPeriods });
  }
  return result;
}

function buildFindings(input: FinanceReportInput, days: ReturnType<typeof accountDays>, payroll: ReportPayrollRow[]): Finding[] {
  const out: Finding[] = [];
  const { today } = input;
  const { lateDays, bigExpense } = input.thresholds;
  const accName = new Map(input.accounts.map(a => [a.id, a.name]));
  const isPosted = (t: ReportTx) => t.status === 'posted';

  // 1. Счёт в минусе.
  for (const a of input.accounts) {
    const d = days.get(a.id);
    if (!d) continue;
    for (const p of d.negPeriods) {
      out.push({
        severity: 'critical', check: 'Счёт ушёл в минус', date: p.from, amount: p.min,
        what: `${a.name}: остаток ниже нуля ${p.days} дн. (${fmtDate(p.from)} — ${p.to ? fmtDate(p.to) : 'по сей день'}), самый низкий ${fmtMoney(p.min)}. Денег на счёте не бывает меньше нуля: не внесён приход или расход записан не на тот счёт.`,
        where: `Счета · ${a.name}`, link: `#'Счета'!A1`,
      });
    }
    if (a.startBalance < -0.004) {
      out.push({ severity: 'warning', check: 'Отрицательный стартовый баланс', date: null, amount: a.startBalance,
        what: `${a.name}: стартовый баланс ${fmtMoney(a.startBalance)} — проверить, с какой суммы начинался учёт.`, where: `Счета · ${a.name}`, link: `#'Счета'!A1` });
    }
    if (a.archived && d && Math.abs(d.current) > 0.004) {
      out.push({ severity: 'warning', check: 'Архивный счёт с остатком', date: today, amount: d.current,
        what: `${a.name} в архиве, но на нём числится ${fmtMoney(d.current)} — деньги «спрятаны» из карточек обзора.`, where: `Счета · ${a.name}`, link: `#'Счета'!A1` });
    }
  }

  // 2–3. Оплаты клиентов.
  for (const p of input.plans) {
    if (p.status === 'expected' && p.earning && p.dueDate && p.dueDate < today) {
      out.push({ severity: 'critical', check: 'Клиент не оплатил в срок', date: p.dueDate, amount: p.amount,
        what: `${p.project}${p.partNo > 1 ? ` (${p.partNo}-я часть)` : ''}: срок ${fmtDate(p.dueDate)}, просрочено ${daysBetween(p.dueDate, today)} дн.${p.manager ? ` Менеджер: ${p.manager}.` : ''}`,
        where: 'Клиенты — оплаты', link: `#'Клиенты — оплаты'!A1` });
    }
    if (p.status === 'received' && !p.receivedTxId) {
      out.push({ severity: 'critical', check: '«Получено» без операции', date: p.dueDate || `${p.ym}-01`, amount: p.amount,
        what: `${p.project}, ${monthLabel(p.ym)}: оплата отмечена полученной, но денег ни на один счёт не записано.`,
        where: 'Клиенты — оплаты', link: `#'Клиенты — оплаты'!A1` });
    }
  }

  // 4. Зарплата.
  const curYm = today.slice(0, 7);
  for (const r of payroll) {
    const owed = r2(Math.max(0, r.salary + r.bonus - r.fine - r.vacation) - r.installment);
    const over = r2(r.paid - owed);
    if (over > 1) {
      out.push({ severity: 'critical', check: 'Зарплата: выплачено больше начисленного', date: null, period: monthLabel(r.ym), amount: over,
        what: `${r.employee}, ${monthLabel(r.ym)}: начислено ${fmtMoney(owed)}, выплачено ${fmtMoney(r.paid)} — переплата ${fmtMoney(over)}.`,
        where: `Зарплата · ${monthLabel(r.ym)}`, link: `#'Зарплата'!A1` });
    } else if (!r.frozen && r.ym < curYm && r.toPay > 1) {
      out.push({ severity: 'warning', check: 'Зарплата не выплачена полностью', date: null, period: monthLabel(r.ym), amount: r.toPay,
        what: `${r.employee}, ${monthLabel(r.ym)}: месяц прошёл, осталось выплатить ${fmtMoney(r.toPay)}.`,
        where: `Зарплата · ${monthLabel(r.ym)}`, link: `#'Зарплата'!A1` });
    } else if (r.frozen && owed - r.paid > 1) {
      out.push({ severity: 'warning', check: 'Закрытый месяц: начислено ≠ выплачено', date: null, period: monthLabel(r.ym), amount: r2(owed - r.paid),
        what: `${r.employee}, ${monthLabel(r.ym)}: месяц закрыт, начислено ${fmtMoney(owed)}, выплачено ${fmtMoney(r.paid)}.`,
        where: `Зарплата · ${monthLabel(r.ym)}`, link: `#'Зарплата'!A1` });
    }
  }

  // 5. Долги и кредиты.
  for (const d of input.debts) {
    const paidAll = r2(d.paidBefore + d.paidInCrm);
    if (paidAll - d.total > 1) {
      out.push({ severity: 'critical', check: 'По долгу отдано больше суммы', date: null, amount: r2(paidAll - d.total),
        what: `${d.name}: занимали ${fmtMoney(d.total)}, отдано ${fmtMoney(paidAll)}.`, where: 'Долги', link: `#'Долги'!A1` });
    }
    if (d.remaining > 0.004 && d.dueDate && d.dueDate < today) {
      out.push({ severity: 'warning', check: 'Долг не возвращён в срок', date: d.dueDate, amount: d.remaining,
        what: `${d.name}: вернуть до ${fmtDate(d.dueDate)}, осталось ${fmtMoney(d.remaining)}.`, where: 'Долги', link: `#'Долги'!A1` });
    }
    for (const tr of d.tranches) {
      if (!tr.received && tr.date < today && d.remaining > 0.004) {
        out.push({ severity: 'warning', check: 'Просрочен транш по долгу', date: tr.date, amount: tr.amount,
          what: `${d.name}: транш ${fmtMoney(tr.amount)} на ${fmtDate(tr.date)} не отдан.`, where: 'Долги', link: `#'Долги'!A1` });
      }
    }
  }
  for (const b of input.banks) {
    for (const p of b.plan) {
      if (p.overdue && !b.done) {
        out.push({ severity: 'warning', check: 'Просрочен платёж банку', date: p.date, amount: p.amount,
          what: `${b.name}${b.bank ? ` (${b.bank})` : ''}: платёж ${fmtMoney(p.amount)} на ${fmtDate(p.date)} не отмечен оплаченным.`,
          where: 'Рассрочки и кредиты', link: `#'Рассрочки и кредиты'!A1` });
      }
    }
    if (b.paid - b.total > 1) {
      out.push({ severity: 'critical', check: 'Банку отдано больше суммы кредита', date: null, amount: r2(b.paid - b.total),
        what: `${b.name}: сумма ${fmtMoney(b.total)}, отдано ${fmtMoney(b.paid)}.`, where: 'Рассрочки и кредиты', link: `#'Рассрочки и кредиты'!A1` });
    }
  }
  for (const i of input.installments) {
    if (i.overdue && !i.done) {
      out.push({ severity: 'warning', check: 'Просрочена рассрочка сотрудника', date: i.overdue.since, amount: i.overdue.amount,
        what: `${i.employee} · ${i.name}: просрочено платежей ${i.overdue.count} на ${fmtMoney(i.overdue.amount)}.`,
        where: 'Рассрочки и кредиты', link: `#'Рассрочки и кредиты'!A1` });
    }
  }

  // 6. Переводы.
  for (const t of input.txs) {
    if (t.status === 'cancelled' || t.legacySaving) continue;
    if ((t.type === 'transfer' || t.type === 'saving') && (!t.fromAccountId || !t.toAccountId || t.fromAccountId === t.toAccountId)) {
      out.push({ severity: 'critical', check: 'Перевод без одного из счетов', date: t.date, amount: t.amount,
        what: !t.fromAccountId || !t.toAccountId
          ? `${TYPE_LABEL[t.type] || t.type}: не указан счёт ${!t.fromAccountId ? 'списания' : 'зачисления'} — деньги «повисли».`
          : `${TYPE_LABEL[t.type] || t.type} со счёта ${accName.get(t.fromAccountId) || ''} на тот же счёт.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
  }

  // 7. Возможные дубли.
  const groups = new Map<string, ReportTx[]>();
  for (const t of input.txs) {
    if (t.status === 'cancelled') continue;
    const key = [t.date, t.type, r2(t.amount), t.accountId || '', t.fromAccountId || '', t.toAccountId || '',
      t.categoryId || '', t.projectId || '', t.employeeId || '', t.debtId || '', t.subscriptionId || ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const t = list[0];
    out.push({ severity: 'warning', check: 'Возможный дубль', date: t.date, amount: r2(t.amount * (list.length - 1)),
      what: `${list.length} одинаковых операции: ${TYPE_LABEL[t.type] || t.type} ${fmtMoney(t.amount)}${t.category ? ` · ${t.category}` : ''}${t.project ? ` · ${t.project}` : ''}${t.employee ? ` · ${t.employee}` : ''} в один день с одного счёта.`,
      where: `Операции · № ${list.map(x => x.no).join(', ')}`, link: opsLink(t.no) });
  }

  // 8. Внесено задним числом / с датой в будущем / без категории и т.п.
  for (const t of input.txs) {
    if (t.status === 'cancelled') continue;
    const created = localIso(t.createdAt);
    if (!t.source && created && created > t.date) {
      const lag = daysBetween(t.date, created);
      if (lag > lateDays) {
        out.push({ severity: 'warning', check: 'Внесено задним числом', date: t.date, amount: t.amount,
          what: `${TYPE_LABEL[t.type] || t.type} за ${fmtDate(t.date)} внесён ${fmtDate(created)} — через ${lag} дн.${t.createdBy ? ` Внёс: ${t.createdBy}.` : ''}`,
          where: `Операции · № ${t.no}`, link: opsLink(t.no) });
      }
    }
    if (t.status === 'future') {
      out.push({ severity: 'info', check: 'Операция с датой в будущем', date: t.date, amount: t.amount,
        what: `${TYPE_LABEL[t.type] || t.type} ${fmtMoney(t.amount)} датирован ${fmtDate(t.date)} — в остатки попадёт только в эту дату.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
    if (t.status === 'pending') {
      out.push({ severity: 'info', check: 'Операция в ожидании', date: t.date, amount: t.amount,
        what: `${TYPE_LABEL[t.type] || t.type} ${fmtMoney(t.amount)} не проведена — в итоги не входит.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
    if (!isPosted(t) && t.status !== 'future') continue;
    if ((t.type === 'income' || t.type === 'expense') && !t.accountId && !t.source) {
      out.push({ severity: 'warning', check: 'Операция без счёта', date: t.date, amount: t.amount,
        what: `${TYPE_LABEL[t.type]} ${fmtMoney(t.amount)} не привязан к счёту — не влияет ни на один остаток.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
    if ((t.type === 'income' || t.type === 'expense') && !t.categoryId && !t.category
      && !t.employeeId && !t.subscriptionId && !t.debtId && !t.projectId) {
      out.push({ severity: 'warning', check: 'Операция без категории', date: t.date, amount: t.amount,
        what: `${TYPE_LABEL[t.type]} ${fmtMoney(t.amount)} без категории — не попадает ни в одну статью.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
    if (t.type === 'income' && !t.projectId && !t.directionLabel && !t.source) {
      out.push({ severity: 'warning', check: 'Доход без клиента', date: t.date, amount: t.amount,
        what: `Доход ${fmtMoney(t.amount)}${t.category ? ` («${t.category}»)` : ''} не привязан к клиенту — непонятно, от кого.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
    if (t.type === 'expense' && t.amount >= bigExpense && !(t.comment || '').trim() && !t.employeeId && !t.subscriptionId && !t.debtId) {
      out.push({ severity: 'info', check: 'Крупный расход без комментария', date: t.date, amount: t.amount,
        what: `${fmtMoney(t.amount)}${t.category ? ` · ${t.category}` : ''} — нет описания, за что.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
  }

  // 9. Изменено после закрытия зарплатного месяца.
  const closed = new Map<string, Date>();
  for (const r of payroll) if (r.closedAt) closed.set(r.ym, r.closedAt);
  for (const t of input.txs) {
    if (!t.employeeId) continue;
    const ym = t.salaryYm || t.date.slice(0, 7);
    const at = closed.get(ym);
    if (!at) continue;
    const touched = [t.createdAt, t.updatedAt].filter(Boolean).map(d => new Date(d!).getTime());
    const after = touched.some(ms => ms > at.getTime() + 60_000);
    if (after) {
      out.push({ severity: 'warning', check: 'Изменено после закрытия зарплатного месяца', date: t.date, amount: t.amount,
        what: `${t.employee || 'Сотрудник'}, ${monthLabel(ym)}: месяц закрыт ${fmtDate(localIso(at))}, а операцию вносили или меняли позже.`,
        where: `Операции · № ${t.no}`, link: opsLink(t.no) });
    }
  }

  // 10. Удалённые и отменённые.
  for (const a of input.activity) {
    if (!/удал/i.test(a.action) && !/^DELETE /.test(a.route || '')) continue;
    out.push({ severity: 'warning', check: 'Удаление в финансах', date: localIso(a.at), amount: null,
      what: `${a.user || 'Кто-то'}: ${a.action}${a.before ? ` — было: ${a.before}` : a.object ? ` — ${a.object}` : ''}.`,
      where: 'Журнал изменений', link: `#'Журнал изменений'!A1` });
  }
  for (const t of input.txs) {
    if (t.status !== 'cancelled') continue;
    out.push({ severity: 'info', check: 'Отменённая операция', date: t.date, amount: t.amount,
      what: `${TYPE_LABEL[t.type] || t.type} ${fmtMoney(t.amount)}${t.comment ? ` · «${t.comment}»` : ''} — в итоги не входит.`,
      where: `Операции · № ${t.no}`, link: opsLink(t.no) });
  }

  // 11. Аренда и подписки по месяцам.
  for (const s of input.subscriptions) {
    for (const cell of subscriptionMonths(s, input)) {
      if (cell.state === 'unpaid') {
        out.push({ severity: 'warning', check: 'Аренда / подписка не оплачена', date: null, period: monthLabel(cell.ym), amount: s.amount,
          what: `${s.name}, ${monthLabel(cell.ym)}: нет ни оплаты, ни отметки «оплачено».`, where: 'Аренда и подписки', link: `#'Аренда и подписки'!A1` });
      } else if (cell.state === 'double') {
        out.push({ severity: 'warning', check: 'Аренда / подписка оплачена дважды', date: null, period: monthLabel(cell.ym), amount: cell.amount,
          what: `${s.name}, ${monthLabel(cell.ym)}: ${cell.count} оплаты на ${fmtMoney(cell.amount)} при ${fmtMoney(s.amount)} в месяц.`,
          where: 'Аренда и подписки', link: `#'Аренда и подписки'!A1` });
      }
    }
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]
    || a.check.localeCompare(b.check, 'ru')
    || String(b.date || b.period || '').localeCompare(String(a.date || a.period || '')));
}

/** Месяцы подписки: оплачено операцией / отметкой / не оплачено / дважды. */
function subscriptionMonths(s: ReportSubscription, input: FinanceReportInput) {
  const pays = input.txs.filter(t => t.subscriptionId === s.id && t.type === 'expense' && (t.status === 'posted' || t.status === 'future'));
  const startYm = (s.start || '').slice(0, 7) || (pays.length ? pays.map(p => p.date.slice(0, 7)).sort()[0] : null);
  const curYm = input.today.slice(0, 7);
  if (!startYm) return [] as Array<{ ym: string; state: string; text: string; amount: number; count: number }>;
  const endYm = s.end ? s.end.slice(0, 7) : curYm;
  const last = endYm < curYm ? endYm : curYm;
  return monthsBetween(startYm, last).map(ym => {
    const inMonth = pays.filter(p => p.date.slice(0, 7) === ym);
    const amount = r2(inMonth.reduce((x, p) => x + p.amount, 0));
    const mark = s.marks.find(m => m.ym === ym);
    if (inMonth.length > 1 && amount > s.amount + 1) {
      return { ym, state: 'double', text: `✓✓ ${inMonth.length} оплаты`, amount, count: inMonth.length };
    }
    if (inMonth.length) return { ym, state: 'paid', text: `✓ ${fmtDate(inMonth[0].date).slice(0, 5)}`, amount, count: inMonth.length };
    if (mark) return { ym, state: 'mark', text: `✓ отметка${mark.date ? ' ' + fmtDate(mark.date).slice(0, 5) : ''}`, amount: 0, count: 0 };
    if (!s.active) return { ym, state: 'off', text: '—', amount: 0, count: 0 };
    const due = s.dueDay ? `${ym}-${String(Math.min(s.dueDay, Number(lastDayOf(ym).slice(8)))).padStart(2, '0')}` : lastDayOf(ym);
    if (due >= input.today) return { ym, state: 'wait', text: 'ждём', amount: 0, count: 0 };
    return { ym, state: 'unpaid', text: '✗ нет', amount: 0, count: 0 };
  });
}

// ─── Сборка книги ────────────────────────────────────────────────────────

export async function buildFinanceReport(input: FinanceReportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SABT CRM';
  wb.company = 'SABT';
  wb.title = 'Финансы SABT — полная выгрузка';
  wb.created = input.exportedAt;
  wb.calcProperties = { fullCalcOnLoad: true };

  const today = input.today;
  const curYm = today.slice(0, 7);
  const firstDate = input.txs.length ? input.txs.reduce((m, t) => (t.date < m ? t.date : m), input.txs[0].date) : today;
  const firstYm = firstDate.slice(0, 7) > curYm ? curYm : firstDate.slice(0, 7);
  const months = monthsBetween(firstYm, curYm);
  const days = accountDays(input, months);
  const findings = buildFindings(input, days, input.payroll);
  const posted = input.txs.filter(t => t.status === 'posted');

  // ── 1. Описание ──
  const s0 = newSheet(wb, 'Описание', 'FF2F3E55');
  s0.getColumn(1).width = 34; s0.getColumn(2).width = 96;
  let r = sheetTitle(s0, 1, 'Финансы SABT — полная выгрузка',
    `Период: с ${fmtDate(firstDate)} (первая операция) по ${fmtDate(today)} · выгружено ${fmtDate(localIso(input.exportedAt))} ${xLocal(input.exportedAt)!.toISOString().slice(11, 16)} (Душанбе)${input.exportedBy ? ` · выгрузил: ${input.exportedBy}` : ''} · валюта — сомони`);
  const crit = findings.filter(f => f.severity === 'critical').length;
  const warn = findings.filter(f => f.severity === 'warning').length;
  const info: Array<[string, string]> = [
    ['Проверки', `Найденные расхождения — ${findings.length}: критично ${crit}, проверить ${warn}, справка ${findings.length - crit - warn}. Начните с этого листа.`],
    ['Итоги по месяцам', 'Доход, расход, прибыль по статьям, ожидания от клиентов и остаток денег на конец каждого месяца.'],
    ['Счета', 'Откуда взялся остаток каждого счёта: стартовый баланс, приходы, расходы, переводы. Самый низкий остаток и дни в минусе. Остатки на конец месяцев.'],
    ['Операции', `Все операции за всё время (${input.txs.length}), включая отменённые: кто и когда внёс, через сколько дней после даты, источник.`],
    ['Клиенты — оплаты', 'Каждая ожидаемая оплата клиента: план, срок, что пришло фактически, просрочка. Итог по каждому клиенту — сколько он должен сейчас.'],
    ['Зарплата', 'Каждый сотрудник за каждый месяц: оклад, бонусы, штрафы, отпускные, удержания, начислено, аванс, выплачено, остаток.'],
    ['Сотрудники', 'Должность, статус, даты приёма и увольнения, история оклада.'],
    ['Долги', 'Долги компании: сколько занимали, сколько отдали, сколько осталось, сроки и все платежи.'],
    ['Рассрочки и кредиты', 'Кредиты и рассрочки банкам и рассрочки сотрудникам — график, оплачено, осталось, просрочки.'],
    ['Аренда и подписки', 'Каждая позиция по месяцам: оплачено операцией, отметкой или не оплачено.'],
    ['Инвентарь', 'Оборудование: цена, амортизация, остаточная стоимость, ответственный.'],
    ['Журнал изменений', 'Всё, что меняли в «Финансах»: кто, когда, что было и что стало.'],
  ];
  const blocks: Array<[string, string]> = [
    ['Как считается', ''],
    ['Остаток счёта', 'стартовый баланс + приходы − расходы ± переводы и накопления. Только проведённые операции с датой не позже сегодняшней.'],
    ['Доход и расход', 'проведённые операции по дате операции. Переводы между своими счетами — не доход и не расход.'],
    ['Прибыль', 'доход − расход. Рентабельность — прибыль / доход.'],
    ['Зарплата', 'относится к месяцу начисления («Месяц ЗП»), даже если выплачена в следующем месяце.'],
    ['Отменённые', 'показаны серым и ни в какие итоги не входят.'],
    ['Архив Notion', 'операции до запуска CRM, перенесённые из Notion; помечены в колонке «Источник».'],
    ['Пороги проверок', `«задним числом» — внесено позже даты операции больше чем на ${input.thresholds.lateDays} дн.; «крупный расход» — от ${input.thresholds.bigExpense} с.`],
    ['Цвета', 'красный — проблема, жёлтый — проверить, зелёный — в порядке, серый курсив — отменено, синий подчёркнутый — ссылка на строку.'],
  ];
  r += 1;
  s0.getCell(r, 1).value = 'Листы'; s0.getCell(r, 1).font = { bold: true, size: 12 }; r++;
  for (const [k, v] of info) {
    const a = s0.getCell(r, 1); a.value = { text: k, hyperlink: `#'${k}'!A1` }; a.font = { color: { argb: C.link }, underline: true };
    const b = s0.getCell(r, 2); b.value = v; b.alignment = { wrapText: true, vertical: 'top' };
    r++;
  }
  r += 1;
  for (const [k, v] of blocks) {
    const a = s0.getCell(r, 1); a.value = k;
    if (!v) { a.font = { bold: true, size: 12 }; r++; continue; }
    a.font = { bold: true };
    const b = s0.getCell(r, 2); b.value = v; b.alignment = { wrapText: true, vertical: 'top' };
    r++;
  }
  r += 1;
  const tones: Array<[string, string, string]> = [[C.bad, C.badInk, 'проблема'], [C.warn, C.warnInk, 'проверить'], [C.ok, C.okInk, 'в порядке'], [C.totalFill, 'FF000000', 'итог']];
  for (const [bg, ink, label] of tones) {
    const a = s0.getCell(r, 1); a.value = label; a.fill = fill(bg); a.font = { color: { argb: ink }, bold: true };
    r++;
  }

  // ── 2. Проверки ──
  const s1 = newSheet(wb, 'Проверки', 'FFB23A2B');
  r = sheetTitle(s1, 1, `Проверки — ${findings.length} ${findings.length % 10 === 1 && findings.length % 100 !== 11 ? 'находка' : [2, 3, 4].includes(findings.length % 10) && ![12, 13, 14].includes(findings.length % 100) ? 'находки' : 'находок'}`,
    'Сначала критичное. «Где смотреть» — лист и номер операции; синие ссылки ведут прямо на строку.');
  const fCols: Col[] = [
    { header: 'Важность', key: 'sev', width: 12 },
    { header: 'Проверка', key: 'check', width: 34 },
    { header: 'Дата / месяц', key: 'when', width: 15 },
    { header: 'Сумма, с.', key: 'amount', width: 14, type: 'signed' },
    { header: 'Что не так', key: 'what', width: 90, type: 'wrap' },
    { header: 'Где смотреть', key: 'where', width: 30 },
  ];
  r = table(s1, r, fCols, findings.map(f => ({
    sev: SEVERITY_LABEL[f.severity], check: f.check,
    when: f.date ? fmtDate(f.date) : f.period || '', amount: f.amount, what: f.what, where: f.where,
    _tone: (f.severity === 'critical' ? 'bad' : f.severity === 'warning' ? 'warn' : null) as RowTone,
    _links: f.link ? { where: f.link } : undefined,
  })), { freeze: true, filter: true });
  // Сводка по видам проверок — под списком.
  const byCheck = new Map<string, { sev: Severity; n: number; sum: number }>();
  for (const f of findings) {
    const x = byCheck.get(f.check) || { sev: f.severity, n: 0, sum: 0 };
    x.n++; x.sum = r2(x.sum + Math.abs(Number(f.amount) || 0));
    byCheck.set(f.check, x);
  }
  r = sheetTitle(s1, r + 1, 'Сводка по проверкам');
  table(s1, r, [
    { header: 'Проверка', key: 'check', width: 34 }, { header: 'Важность', key: 'sev', width: 12 },
    { header: 'Найдено', key: 'n', width: 10, type: 'int' }, { header: 'Сумма, с.', key: 'sum', width: 14, type: 'money' },
  ], [...byCheck.entries()].map(([check, x]) => ({ check, sev: SEVERITY_LABEL[x.sev], n: x.n, sum: x.sum,
    _tone: (x.sev === 'critical' ? 'bad' : x.sev === 'warning' ? 'warn' : null) as RowTone })));

  // ── 3. Итоги по месяцам ──
  const s2 = newSheet(wb, 'Итоги по месяцам', 'FF1F7244');
  r = sheetTitle(s2, 1, 'Итоги по месяцам', 'Проведённые операции по дате. Строка «Всё время» — сумма формулами. Остаток — все счета на конец месяца (текущий — на сегодня).');
  const DIRS: Array<[string, string]> = [['smm', 'SMM'], ['development', 'Development'], ['design', 'Design'], ['maintenance', 'Обслуживание']];
  const EXP: Array<[string, string]> = [['salary', 'Зарплата'], ['rent_subs', 'Аренда и подписки'], ['debts', 'Долги'], ['installments', 'Кредиты банкам'], ['transport', 'Транспорт'], ['other', 'Прочее']];
  const monthRows = months.map(ym => {
    const inM = posted.filter(t => t.date.slice(0, 7) === ym);
    const inc = inM.filter(t => t.type === 'income');
    const exp = inM.filter(t => t.type === 'expense');
    const sum = (a: ReportTx[]) => r2(a.reduce((s, t) => s + t.amount, 0));
    const income = sum(inc), expense = sum(exp);
    const row: Row = {
      ym: ym === curYm ? `${monthLabel(ym)} (идёт)` : monthLabel(ym),
      income, expense, profit: r2(income - expense), margin: income > 0 ? (income - expense) / income : null,
      transfers: sum(inM.filter(t => t.type === 'transfer')), savings: sum(inM.filter(t => t.type === 'saving')),
      ops: input.txs.filter(t => t.date.slice(0, 7) === ym).length,
      cancelled: input.txs.filter(t => t.date.slice(0, 7) === ym && t.status === 'cancelled').length,
    };
    for (const [k] of DIRS) row[`d_${k}`] = sum(inc.filter(t => t.groupKey === k));
    row.d_none = sum(inc.filter(t => !DIRS.some(([k]) => k === t.groupKey)));
    for (const [k] of EXP) row[`e_${k}`] = sum(exp.filter(t => (t.groupKey || 'other') === k));
    const plans = input.plans.filter(p => p.ym === ym && (p.status === 'received' || p.earning));
    row.planned = r2(plans.reduce((s, p) => s + p.amount, 0));
    row.receivedPlan = r2(plans.filter(p => p.status === 'received').reduce((s, p) => s + p.amount, 0));
    row.missing = r2(Math.max(0, row.planned - row.receivedPlan));
    row.balance = r2(input.accounts.reduce((s, a) => s + (days.get(a.id)?.monthEnd[ym] ?? a.startBalance), 0));
    row._tone = row.balance < -0.004 ? 'bad' : null;
    return row;
  });
  const mCols: Col[] = [
    { header: 'Месяц', key: 'ym', width: 18 },
    { header: 'Доход', key: 'income', width: 14, type: 'money', total: 'sum' },
    { header: 'Расход', key: 'expense', width: 14, type: 'money', total: 'sum' },
    { header: 'Прибыль', key: 'profit', width: 14, type: 'signed', total: 'sum' },
    { header: 'Рентаб.', key: 'margin', width: 9, type: 'percent' },
    ...DIRS.map(([k, l]) => ({ header: `Доход: ${l}`, key: `d_${k}`, width: 14, type: 'money' as ColType, total: 'sum' as const })),
    { header: 'Доход без направления', key: 'd_none', width: 14, type: 'money', total: 'sum' },
    ...EXP.map(([k, l]) => ({ header: `Расход: ${l}`, key: `e_${k}`, width: 14, type: 'money' as ColType, total: 'sum' as const })),
    { header: 'Переводы между счетами', key: 'transfers', width: 14, type: 'money', total: 'sum' },
    { header: 'Накопления', key: 'savings', width: 13, type: 'money', total: 'sum' },
    { header: 'Ждали от клиентов (план)', key: 'planned', width: 15, type: 'money', total: 'sum' },
    { header: 'Получено по плану', key: 'receivedPlan', width: 15, type: 'money', total: 'sum' },
    { header: 'Не получено по плану', key: 'missing', width: 15, type: 'money', total: 'sum' },
    { header: 'Остаток денег на конец месяца', key: 'balance', width: 16, type: 'signed' },
    { header: 'Операций', key: 'ops', width: 10, type: 'int', total: 'sum' },
    { header: 'Отменено', key: 'cancelled', width: 10, type: 'int', total: 'sum' },
  ];
  table(s2, r, mCols, monthRows, { freeze: true, totalLabel: 'Всё время' });
  s2.views = [{ state: 'frozen', ySplit: r, xSplit: 1 }];

  // ── 4. Счета ──
  const s3 = newSheet(wb, 'Счета', 'FF2F5DA8');
  r = sheetTitle(s3, 1, 'Счета', 'Остаток = стартовый баланс + приходы − расходы + переводы на счёт − переводы со счёта. Только проведённые операции, влияющие на баланс.');
  const accRows = input.accounts.map(a => {
    const mine = posted.filter(t => t.affectsBalance);
    const sum = (f: (t: ReportTx) => boolean) => r2(mine.filter(f).reduce((s, t) => s + t.amount, 0));
    const d = days.get(a.id)!;
    return {
      name: a.name + (a.archived ? ' (архив)' : ''), kind: a.kind === 'cash' ? 'Наличные' : 'Банк', start: a.startBalance,
      inc: sum(t => t.type === 'income' && t.accountId === a.id),
      exp: sum(t => t.type === 'expense' && t.accountId === a.id),
      tin: sum(t => ((t.type === 'transfer' || t.type === 'saving') && !t.legacySaving && t.toAccountId === a.id) || (t.legacySaving && t.accountId === a.id)),
      tout: sum(t => (t.type === 'transfer' || t.type === 'saving') && !t.legacySaving && t.fromAccountId === a.id),
      now: d.current, min: d.min, minDate: d.minDate, neg: d.negDays,
      _tone: (d.current < -0.004 || d.negDays > 0 ? 'bad' : null) as RowTone,
    };
  });
  r = table(s3, r, [
    { header: 'Счёт', key: 'name', width: 24 }, { header: 'Вид', key: 'kind', width: 11 },
    { header: 'Стартовый баланс', key: 'start', width: 15, type: 'signed', total: 'sum' },
    { header: 'Приходы', key: 'inc', width: 15, type: 'money', total: 'sum' },
    { header: 'Расходы', key: 'exp', width: 15, type: 'money', total: 'sum' },
    { header: 'Переводы на счёт', key: 'tin', width: 15, type: 'money', total: 'sum' },
    { header: 'Переводы со счёта', key: 'tout', width: 15, type: 'money', total: 'sum' },
    { header: 'Остаток сейчас', key: 'now', width: 15, type: 'signed', total: 'sum' },
    { header: 'Самый низкий остаток', key: 'min', width: 15, type: 'signed' },
    { header: 'Когда', key: 'minDate', width: 12, type: 'date' },
    { header: 'Дней в минусе', key: 'neg', width: 10, type: 'int' },
  ], accRows, { freeze: true, totalLabel: 'Все счета' });
  r = sheetTitle(s3, r + 1, 'Остаток на конец месяца', 'Строка — месяц, колонка — счёт. Текущий месяц — на сегодня.');
  const balCols: Col[] = [{ header: 'Месяц', key: 'ym', width: 18 },
    ...input.accounts.map(a => ({ header: a.name, key: `a_${a.id}`, width: 15, type: 'signed' as ColType })),
    { header: 'Все счета', key: 'all', width: 15, type: 'signed' }];
  table(s3, r, balCols, months.map(ym => {
    const row: Row = { ym: monthLabel(ym) };
    let all = 0;
    for (const a of input.accounts) { const v = days.get(a.id)?.monthEnd[ym] ?? a.startBalance; row[`a_${a.id}`] = v; all += v; }
    row.all = r2(all);
    return row;
  }));

  // ── 5. Операции ──
  const s4 = newSheet(wb, 'Операции', 'FF5A6170');
  r = sheetTitle(s4, 1, `Операции — все ${input.txs.length}, включая отменённые`,
    'Сумма всегда положительная; «Влияние» — плюс для дохода, минус для расхода, ноль для переводов. «Задним числом» — сколько дней прошло от даты операции до внесения.');
  const opCols: Col[] = [
    { header: '№', key: 'no', width: 7, type: 'int' },
    { header: 'Дата', key: 'date', width: 11, type: 'date' },
    { header: 'Месяц', key: 'ym', width: 9 },
    { header: 'Тип', key: 'type', width: 11 },
    { header: 'Статус', key: 'status', width: 13 },
    { header: 'Сумма', key: 'amount', width: 14, type: 'money' },
    { header: 'Влияние на деньги', key: 'effect', width: 14, type: 'signed' },
    { header: 'Счёт (списание)', key: 'from', width: 16 },
    { header: 'Счёт (зачисление)', key: 'to', width: 16 },
    { header: 'Категория', key: 'category', width: 18 },
    { header: 'Статья', key: 'group', width: 18 },
    { header: 'Направление', key: 'direction', width: 14 },
    { header: 'Клиент / проект', key: 'project', width: 22 },
    { header: 'Сотрудник', key: 'employee', width: 22 },
    { header: 'Получатель (транспорт)', key: 'recipient', width: 20 },
    { header: 'Месяц ЗП', key: 'salaryYm', width: 14 },
    { header: 'Долг / кредит', key: 'debt', width: 18 },
    { header: 'Аренда / подписка', key: 'subscription', width: 18 },
    { header: 'Контрагент', key: 'counterparty', width: 18 },
    { header: 'Комментарий', key: 'comment', width: 32 },
    { header: 'Описание (архив)', key: 'description', width: 28 },
    { header: 'Способ оплаты', key: 'method', width: 13 },
    { header: 'Источник', key: 'source', width: 14 },
    { header: 'Влияет на баланс', key: 'affects', width: 10 },
    { header: 'Внёс', key: 'createdBy', width: 18 },
    { header: 'Внесено', key: 'createdAt', width: 16, type: 'datetime' },
    { header: 'Изменено', key: 'updatedAt', width: 16, type: 'datetime' },
    { header: 'Задним числом, дн.', key: 'lag', width: 11, type: 'int' },
    { header: 'ID операции', key: 'id', width: 38 },
  ];
  table(s4, r, opCols, input.txs.map(t => {
    const created = localIso(t.createdAt);
    const lag = created && !t.source ? Math.max(0, daysBetween(t.date, created)) : null;
    const effect = t.status !== 'posted' ? 0 : t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
    const fromName = t.type === 'expense' ? t.accountName : t.type === 'transfer' || t.type === 'saving' ? (t.legacySaving ? null : t.fromName) : null;
    const toName = t.type === 'income' ? t.accountName : t.type === 'transfer' || t.type === 'saving' ? (t.legacySaving ? t.accountName : t.toName) : null;
    return {
      no: t.no, date: t.date, ym: t.date.slice(0, 7), type: TYPE_LABEL[t.type] || t.type, status: STATUS_LABEL[t.status],
      amount: t.amount, effect, from: fromName, to: toName, category: t.category, group: t.groupLabel,
      direction: t.directionLabel, project: t.project, employee: t.employee, recipient: t.recipient,
      salaryYm: t.salaryYm ? monthLabel(t.salaryYm) : null, debt: t.debt, subscription: t.subscription,
      counterparty: t.counterparty, comment: t.comment, description: t.description, method: t.paymentMethod,
      source: t.source === 'notion' ? 'Архив Notion' : t.source ? t.source : 'CRM', affects: t.affectsBalance ? 'да' : 'нет',
      createdBy: t.createdBy, createdAt: xLocal(t.createdAt), updatedAt: xLocal(t.updatedAt), lag, id: t.id,
      _tone: (t.status === 'cancelled' ? 'gray' : lag != null && lag > input.thresholds.lateDays ? 'warn' : null) as RowTone,
    };
  }), { freeze: true, filter: true });
  s4.views = [{ state: 'frozen', ySplit: r, xSplit: 2 }];

  // ── 6. Клиенты — оплаты ──
  const s5 = newSheet(wb, 'Клиенты — оплаты', 'FF20B965');
  r = sheetTitle(s5, 1, 'Клиенты — оплаты', 'Сверху — итог по каждому клиенту, ниже — каждая ожидаемая оплата. «Долг клиента» — просроченные неоплаченные части.');
  const byClient = new Map<string, { direction: string | null; manager: string | null; status: string; planned: number; received: number; overdue: number; overdueN: number; next: string | null }>();
  for (const p of input.plans) {
    const x = byClient.get(p.project) || { direction: p.direction, manager: p.manager, status: p.projectStatus, planned: 0, received: 0, overdue: 0, overdueN: 0, next: null };
    if (p.status === 'received' || p.earning) x.planned = r2(x.planned + p.amount);
    if (p.status === 'received') x.received = r2(x.received + (p.receivedTx ? p.receivedTx.amount : p.amount));
    if (p.status === 'expected' && p.earning && p.dueDate && p.dueDate < today) { x.overdue = r2(x.overdue + p.amount); x.overdueN++; }
    if (p.status === 'expected' && p.earning && p.dueDate && p.dueDate >= today && (!x.next || p.dueDate < x.next)) x.next = p.dueDate;
    byClient.set(p.project, x);
  }
  r = table(s5, r, [
    { header: 'Клиент', key: 'client', width: 26 }, { header: 'Направление', key: 'direction', width: 14 },
    { header: 'Менеджер', key: 'manager', width: 20 }, { header: 'Статус проекта', key: 'status', width: 14 },
    { header: 'Ждали всего', key: 'planned', width: 14, type: 'money', total: 'sum' },
    { header: 'Получено всего', key: 'received', width: 14, type: 'money', total: 'sum' },
    { header: 'Долг клиента (просрочено)', key: 'overdue', width: 15, type: 'money', total: 'sum' },
    { header: 'Просрочено частей', key: 'overdueN', width: 11, type: 'int', total: 'sum' },
    { header: 'Ближайший срок', key: 'next', width: 13, type: 'date' },
  ], [...byClient.entries()].sort((a, b) => b[1].overdue - a[1].overdue || a[0].localeCompare(b[0], 'ru')).map(([client, x]) => ({
    client, direction: x.direction, manager: x.manager, status: x.status, planned: x.planned, received: x.received,
    overdue: x.overdue, overdueN: x.overdueN, next: x.next, _tone: (x.overdue > 0 ? 'bad' : null) as RowTone,
  })), { freeze: true, totalLabel: 'Все клиенты' });
  r = sheetTitle(s5, r + 1, 'Каждая ожидаемая оплата');
  table(s5, r, [
    { header: 'Клиент', key: 'client', width: 26 }, { header: 'Направление', key: 'direction', width: 14 },
    { header: 'Менеджер', key: 'manager', width: 20 }, { header: 'Тариф', key: 'tariff', width: 12, type: 'money' },
    { header: 'Месяц', key: 'ym', width: 15 }, { header: 'Часть', key: 'part', width: 7, type: 'int' },
    { header: 'По плану', key: 'amount', width: 13, type: 'money' }, { header: 'Срок', key: 'due', width: 11, type: 'date' },
    { header: 'Статус', key: 'status', width: 22 }, { header: 'Получено (дата)', key: 'rDate', width: 13, type: 'date' },
    { header: 'Получено, с.', key: 'rAmount', width: 13, type: 'money' }, { header: 'На счёт', key: 'rAcc', width: 15 },
    { header: 'Разница', key: 'diff', width: 12, type: 'signed' }, { header: 'Дней просрочки', key: 'late', width: 10, type: 'int' },
    { header: 'Операция', key: 'op', width: 12 }, { header: 'Создан автоматически', key: 'auto', width: 11 },
  ], [...input.plans].sort((a, b) => a.ym.localeCompare(b.ym) || a.project.localeCompare(b.project, 'ru') || a.partNo - b.partNo).map(p => {
    const overdue = p.status === 'expected' && p.earning && !!p.dueDate && p.dueDate < today;
    const status = p.status === 'received'
      ? (p.receivedTxId ? 'Получено' : 'Отмечено без операции')
      : !p.earning ? `Не ждём (${p.projectStatus})` : overdue ? 'Просрочено' : 'Ждём';
    const got = p.receivedTx ? p.receivedTx.amount : 0;
    return {
      client: p.project, direction: p.direction, manager: p.manager, tariff: p.tariff, ym: monthLabel(p.ym), part: p.partNo,
      amount: p.amount, due: p.dueDate, status, rDate: p.receivedTx?.date ?? null, rAmount: p.receivedTx ? got : null,
      rAcc: p.receivedTx?.account ?? null, diff: p.status === 'received' && p.receivedTx ? r2(got - p.amount) : overdue ? -p.amount : null,
      late: overdue ? daysBetween(p.dueDate!, today) : null,
      op: p.receivedTx ? `№ ${p.receivedTx.no}` : null, auto: p.auto ? 'да' : 'нет',
      _tone: (overdue || (p.status === 'received' && !p.receivedTxId) ? 'bad' : p.status === 'received' ? 'ok' : !p.earning ? 'gray' : null) as RowTone,
      _links: p.receivedTx ? { op: opsLink(p.receivedTx.no) } : undefined,
    };
  }), { filter: false });

  // ── 7. Зарплата ──
  const s6 = newSheet(wb, 'Зарплата', 'FFEE980D');
  r = sheetTitle(s6, 1, 'Зарплата — каждый сотрудник за каждый месяц',
    'Начислено = оклад + бонусы − штрафы − отпускные − удержание рассрочки. Остаток: плюс — компания должна сотруднику, минус — переплата. Аванс входит в «Выплачено».');
  const payRows = input.payroll.map(p => {
    const accrued = r2(Math.max(0, p.salary + p.bonus - p.fine - p.vacation) - p.installment);
    const balance = p.frozen ? r2(accrued - p.paid) : r2(Math.max(p.toPay, accrued - p.paid));
    return {
      ym: monthLabel(p.ym), employee: p.employee, role: p.role, salary: p.salary, bonus: p.bonus, fine: p.fine,
      vacation: p.vacation, installment: p.installment, accrued, advance: p.advance, paid: p.paid, balance,
      closed: p.frozen ? (p.paidAt ? `выплачено ${fmtDate(p.paidAt)}` : 'закрыт') : p.periodStatus === 'closed' ? 'закрыт' : 'открыт',
      _tone: (p.paid - accrued > 1 ? 'bad' : balance > 1 && p.ym < curYm ? 'warn' : null) as RowTone,
    };
  });
  r = table(s6, r, [
    { header: 'Месяц', key: 'ym', width: 15 }, { header: 'Сотрудник', key: 'employee', width: 28 }, { header: 'Должность', key: 'role', width: 20 },
    { header: 'Оклад', key: 'salary', width: 12, type: 'money', total: 'sum' }, { header: 'Бонусы', key: 'bonus', width: 11, type: 'money', total: 'sum' },
    { header: 'Штрафы', key: 'fine', width: 11, type: 'money', total: 'sum' }, { header: 'Отпускные', key: 'vacation', width: 11, type: 'money', total: 'sum' },
    { header: 'Рассрочка', key: 'installment', width: 11, type: 'money', total: 'sum' }, { header: 'Начислено', key: 'accrued', width: 12, type: 'money', total: 'sum' },
    { header: 'Аванс', key: 'advance', width: 11, type: 'money', total: 'sum' }, { header: 'Выплачено всего', key: 'paid', width: 13, type: 'money', total: 'sum' },
    { header: 'Остаток', key: 'balance', width: 12, type: 'signed', total: 'sum' }, { header: 'Месяц', key: 'closed', width: 20 },
  ], payRows, { freeze: true, filter: true, totalLabel: 'Всё время' });
  const payMonths = [...new Set(input.payroll.map(p => p.ym))].sort();
  const people = [...new Set(input.payroll.map(p => p.employee))];
  if (payMonths.length && people.length) {
    r = sheetTitle(s6, r + 1, 'Выплачено: сотрудник × месяц', 'Пустая клетка — сотрудник в этом месяце не работал; ноль — работал, но выплат нет.');
    table(s6, r, [{ header: 'Сотрудник', key: 'employee', width: 28 },
      ...payMonths.map(ym => ({ header: monthLabel(ym), key: ym, width: 13, type: 'money' as ColType })),
      { header: 'Итого', key: 'all', width: 14, type: 'money' }],
    people.map(name => {
      const row: Row = { employee: name };
      let all = 0;
      for (const ym of payMonths) {
        const p = input.payroll.find(x => x.employee === name && x.ym === ym);
        row[ym] = p ? p.paid : null;
        all += p ? p.paid : 0;
      }
      row.all = r2(all);
      return row;
    }));
  }

  // ── 8. Сотрудники ──
  const s7 = newSheet(wb, 'Сотрудники', 'FF8B6FC8');
  r = sheetTitle(s7, 1, 'Сотрудники', 'Все сотрудники из ведомости, включая уволенных.');
  const STATUS_RU: Record<string, string> = { active: 'Активный', inactive: 'Неактивный', fired: 'Уволен', vacation: 'В отпуске' };
  table(s7, r, [
    { header: 'Сотрудник', key: 'name', width: 30 }, { header: 'Должность', key: 'role', width: 22 }, { header: 'Отдел', key: 'category', width: 14 },
    { header: 'Статус', key: 'status', width: 12 }, { header: 'Принят', key: 'hire', width: 11, type: 'date' },
    { header: 'Уволен', key: 'term', width: 11, type: 'date' }, { header: 'Оклад сейчас', key: 'salary', width: 13, type: 'money' },
    { header: 'Изменения оклада', key: 'history', width: 60, type: 'wrap' }, { header: 'Аккаунт в CRM', key: 'crm', width: 12 },
  ], input.employees.map(e => ({
    name: e.name, role: e.role, category: e.category, status: STATUS_RU[e.status || ''] || e.status,
    hire: e.hireDate, term: e.terminationDate, salary: e.salaryNow,
    history: Object.entries(e.salaryHistory || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `с ${k.length === 7 ? monthLabel(k) : fmtDate(k)} — ${fmtMoney(Number(v))}`).join('; '),
    crm: e.hasCrmUser ? 'есть' : 'нет',
    _tone: (e.status === 'fired' || e.terminationDate ? 'gray' : null) as RowTone,
  })), { freeze: true, filter: true });

  // ── 9. Долги ──
  const s8 = newSheet(wb, 'Долги', 'FFE6535F');
  r = sheetTitle(s8, 1, 'Долги компании', 'Без кредитов и рассрочек банков — они на листе «Рассрочки и кредиты».');
  r = table(s8, r, [
    { header: 'Кому', key: 'name', width: 26 }, { header: 'Контрагент', key: 'cp', width: 18 },
    { header: 'Сумма долга', key: 'total', width: 13, type: 'money', total: 'sum' }, { header: 'Отдали до CRM', key: 'before', width: 13, type: 'money', total: 'sum' },
    { header: 'Отдано в CRM', key: 'paid', width: 13, type: 'money', total: 'sum' }, { header: 'Осталось', key: 'rest', width: 13, type: 'money', total: 'sum' },
    { header: 'Вернуть до', key: 'due', width: 11, type: 'date' }, { header: 'Статус', key: 'status', width: 16 },
    { header: 'Траншей по плану', key: 'tr', width: 10, type: 'int' }, { header: 'Записан', key: 'created', width: 11, type: 'date' },
    { header: 'Примечание', key: 'note', width: 30, type: 'wrap' },
  ], input.debts.map(d => {
    const late = d.remaining > 0.004 && d.dueDate && d.dueDate < today;
    return {
      name: d.name, cp: d.counterparty, total: d.total, before: d.paidBefore, paid: d.paidInCrm, rest: d.remaining, due: d.dueDate,
      status: d.remaining <= 0.004 ? 'Закрыт' : late ? 'Просрочен' : d.dueDate ? 'В срок' : 'Без срока', tr: d.tranches.length,
      created: localIso(d.createdAt), note: d.note,
      _tone: (d.remaining <= 0.004 ? 'ok' : late ? 'bad' : null) as RowTone,
    };
  }), { freeze: true, totalLabel: 'Все долги' });
  const debtPays = input.txs.filter(t => t.debtId && input.debts.some(d => d.id === t.debtId));
  r = sheetTitle(s8, r + 1, 'Все платежи по долгам');
  r = table(s8, r, [
    { header: 'Дата', key: 'date', width: 11, type: 'date' }, { header: 'Долг', key: 'debt', width: 26 },
    { header: 'Сумма', key: 'amount', width: 13, type: 'money', total: 'sum' }, { header: 'Со счёта', key: 'acc', width: 16 },
    { header: 'Статус', key: 'status', width: 13 }, { header: 'Комментарий', key: 'comment', width: 32 }, { header: 'Операция', key: 'op', width: 12 },
  ], debtPays.map(t => ({ date: t.date, debt: t.debt, amount: t.status === 'cancelled' ? 0 : t.amount, acc: t.accountName, status: STATUS_LABEL[t.status],
    comment: t.comment, op: `№ ${t.no}`, _tone: (t.status === 'cancelled' ? 'gray' : null) as RowTone, _links: { op: opsLink(t.no) } })), { totalLabel: 'Итого' });
  const tranches = input.debts.flatMap(d => d.tranches.map(tr => ({ ...tr, debt: d.name, rest: d.remaining })));
  if (tranches.length) {
    r = sheetTitle(s8, r + 1, 'План траншей');
    table(s8, r, [
      { header: 'Дата', key: 'date', width: 11, type: 'date' }, { header: 'Долг', key: 'debt', width: 26 },
      { header: 'Сумма', key: 'amount', width: 13, type: 'money' }, { header: 'Статус', key: 'status', width: 14 },
    ], tranches.sort((a, b) => a.date.localeCompare(b.date)).map(tr => {
      const late = !tr.received && tr.date < today && tr.rest > 0.004;
      return { date: tr.date, debt: tr.debt, amount: tr.amount, status: tr.received ? 'Отдано' : late ? 'Просрочено' : 'По плану',
        _tone: (tr.received ? 'ok' : late ? 'bad' : null) as RowTone };
    }));
  }

  // ── 10. Рассрочки и кредиты ──
  const s9 = newSheet(wb, 'Рассрочки и кредиты', 'FF47AAA4');
  r = sheetTitle(s9, 1, 'Кредиты и рассрочки банкам', 'Деньги, которые компания платит банкам по графику.');
  r = table(s9, r, [
    { header: 'Название', key: 'name', width: 26 }, { header: 'Банк', key: 'bank', width: 16 },
    { header: 'Сумма', key: 'total', width: 13, type: 'money', total: 'sum' }, { header: 'В месяц', key: 'monthly', width: 12, type: 'money', total: 'sum' },
    { header: 'День платежа', key: 'day', width: 9, type: 'int' }, { header: 'Оплачено', key: 'paid', width: 13, type: 'money', total: 'sum' },
    { header: 'Осталось', key: 'rest', width: 13, type: 'money', total: 'sum' }, { header: 'Следующий платёж', key: 'next', width: 13, type: 'date' },
    { header: 'Сумма платежа', key: 'nextAmount', width: 12, type: 'money' }, { header: 'Просрочено платежей', key: 'late', width: 11, type: 'int' },
    { header: 'Примечание', key: 'note', width: 26, type: 'wrap' },
  ], input.banks.map(b => {
    const late = b.plan.filter(p => p.overdue).length;
    return { name: b.name, bank: b.bank, total: b.total, monthly: b.monthly, day: b.dueDay, paid: b.paid, rest: b.remaining,
      next: b.next?.date ?? null, nextAmount: b.next?.amount ?? null, late, note: b.note,
      _tone: (b.done ? 'ok' : late ? 'bad' : null) as RowTone };
  }), { freeze: true, totalLabel: 'Все кредиты' });
  r = sheetTitle(s9, r + 1, 'Рассрочки сотрудникам', 'Сотрудник возвращает компании деньги — удержанием из зарплаты или отдельно.');
  r = table(s9, r, [
    { header: 'Сотрудник', key: 'emp', width: 26 }, { header: 'За что', key: 'name', width: 22 }, { header: 'Как возвращает', key: 'method', width: 18 },
    { header: 'Сумма', key: 'total', width: 13, type: 'money', total: 'sum' }, { header: 'В месяц', key: 'monthly', width: 12, type: 'money' },
    { header: 'С месяца', key: 'start', width: 14 }, { header: 'Оплачено', key: 'paid', width: 13, type: 'money', total: 'sum' },
    { header: 'Осталось', key: 'rest', width: 13, type: 'money', total: 'sum' }, { header: 'Следующий платёж', key: 'next', width: 13, type: 'date' },
    { header: 'Просрочено, с.', key: 'late', width: 12, type: 'money' },
  ], input.installments.map(i => ({ emp: i.employee, name: i.name, method: i.method === 'separate' ? 'отдельно' : 'удержание из ЗП',
    total: i.total, monthly: i.monthly, start: i.startYm ? monthLabel(i.startYm) : null, paid: i.paid, rest: i.remaining,
    next: i.next?.date ?? null, late: i.overdue?.amount ?? null,
    _tone: (i.done ? 'ok' : i.overdue ? 'warn' : null) as RowTone })), { totalLabel: 'Все рассрочки' });
  const sched = [
    ...input.banks.flatMap(b => b.plan.map(p => ({ date: p.date, who: `${b.name}${b.bank ? ` (${b.bank})` : ''}`, kind: 'Банку', amount: p.amount,
      status: p.paid ? 'Оплачено' : p.overdue ? 'Просрочено' : 'По плану' }))),
    ...input.installments.flatMap(i => i.schedule.map(x => ({ date: x.date, who: `${i.employee} · ${i.name}`, kind: 'Сотрудник', amount: x.amount,
      status: x.outstanding <= 0.004 ? 'Оплачено' : x.status === 'overdue' ? 'Просрочено' : 'По плану' }))),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (sched.length) {
    r = sheetTitle(s9, r + 1, 'График платежей');
    table(s9, r, [
      { header: 'Дата', key: 'date', width: 11, type: 'date' }, { header: 'Кто / что', key: 'who', width: 34 },
      { header: 'Кому платят', key: 'kind', width: 12 }, { header: 'Сумма', key: 'amount', width: 12, type: 'money' },
      { header: 'Статус', key: 'status', width: 12 },
    ], sched.map(x => ({ ...x, _tone: (x.status === 'Оплачено' ? 'ok' : x.status === 'Просрочено' ? 'bad' : null) as RowTone })));
  }

  // ── 11. Аренда и подписки ──
  const s10 = newSheet(wb, 'Аренда и подписки', 'FF8385FF');
  r = sheetTitle(s10, 1, 'Аренда и подписки — оплата по месяцам',
    '«✓ 05.07» — оплачено операцией этого числа; «✓ отметка» — отмечено оплаченным без операции; «✗ нет» — месяц прошёл, оплаты нет; «ждём» — срок ещё не наступил; «—» — позиция не действовала.');
  const subMonths = months.filter(ym => input.subscriptions.some(s => (s.start || '').slice(0, 7) <= ym || !s.start));
  const subRows = input.subscriptions.map(s => {
    const cells = subscriptionMonths(s, input);
    const row: Row = { name: s.name, kind: s.kind === 'rent' ? 'Аренда' : 'Подписка', amount: s.amount, day: s.dueDay ? `до ${s.dueDay}-го` : '',
      start: s.start, end: s.end, active: s.active ? 'да' : 'нет',
      unpaid: cells.filter(c => c.state === 'unpaid').length };
    for (const ym of subMonths) row[ym] = cells.find(c => c.ym === ym)?.text ?? '';
    row._tone = (row.unpaid > 0 ? 'warn' : !s.active ? 'gray' : null) as RowTone;
    return row;
  });
  r = table(s10, r, [
    { header: 'Позиция', key: 'name', width: 24 }, { header: 'Тип', key: 'kind', width: 10 },
    { header: 'В месяц', key: 'amount', width: 12, type: 'money', total: 'sum' }, { header: 'День оплаты', key: 'day', width: 11 },
    { header: 'С', key: 'start', width: 11, type: 'date' }, { header: 'По', key: 'end', width: 11, type: 'date' },
    { header: 'Действует', key: 'active', width: 10 }, { header: 'Не оплачено месяцев', key: 'unpaid', width: 11, type: 'int', total: 'sum' },
    ...subMonths.map(ym => ({ header: monthLabel(ym), key: ym, width: 13 })),
  ], subRows, { freeze: true, totalLabel: 'Итого в месяц' });
  const subPays = input.txs.filter(t => t.subscriptionId);
  r = sheetTitle(s10, r + 1, 'Все оплаты аренды и подписок');
  table(s10, r, [
    { header: 'Дата', key: 'date', width: 11, type: 'date' }, { header: 'Позиция', key: 'sub', width: 24 },
    { header: 'Сумма', key: 'amount', width: 12, type: 'money', total: 'sum' }, { header: 'Со счёта', key: 'acc', width: 16 },
    { header: 'Статус', key: 'status', width: 13 }, { header: 'Комментарий', key: 'comment', width: 30 }, { header: 'Операция', key: 'op', width: 12 },
  ], subPays.map(t => ({ date: t.date, sub: t.subscription, amount: t.status === 'cancelled' ? 0 : t.amount, acc: t.accountName,
    status: STATUS_LABEL[t.status], comment: t.comment, op: `№ ${t.no}`,
    _tone: (t.status === 'cancelled' ? 'gray' : null) as RowTone, _links: { op: opsLink(t.no) } })), { totalLabel: 'Итого' });

  // ── 12. Инвентарь ──
  const s11 = newSheet(wb, 'Инвентарь', 'FFC9A227');
  r = sheetTitle(s11, 1, 'Инвентарь', 'Амортизация линейная: цена / срок службы в месяцах. Списанное и проданное — остаточная стоимость 0.');
  const ASSET_STATUS: Record<string, string> = { in_use: 'В работе', repair: 'В ремонте', written_off: 'Списано', sold: 'Продано', lost: 'Потеряно' };
  table(s11, r, [
    { header: 'Название', key: 'name', width: 26 }, { header: 'Категория', key: 'cat', width: 14 }, { header: 'Куплено', key: 'date', width: 11, type: 'date' },
    { header: 'Цена', key: 'price', width: 12, type: 'money', total: 'sum' }, { header: 'Срок, мес', key: 'life', width: 9, type: 'int' },
    { header: 'Амортизация в месяц', key: 'dep', width: 12, type: 'money', total: 'sum' }, { header: 'Самортизировано', key: 'depd', width: 13, type: 'money', total: 'sum' },
    { header: 'Остаточная стоимость', key: 'res', width: 13, type: 'money', total: 'sum' }, { header: 'Статус', key: 'status', width: 12 },
    { header: 'Ответственный', key: 'who', width: 18 }, { header: 'Серийный номер', key: 'serial', width: 18 },
    { header: 'Гарантия до', key: 'warranty', width: 11, type: 'date' }, { header: 'Примечание', key: 'note', width: 28, type: 'wrap' },
  ], input.assets.map(a => ({ name: a.name, cat: a.category, date: a.purchaseDate, price: a.price, life: a.serviceMonths, dep: a.monthlyDep,
    depd: a.depreciated, res: a.residual, status: ASSET_STATUS[a.status || ''] || a.status, who: a.assignee, serial: a.serial,
    warranty: a.warrantyUntil, note: a.note, _tone: (a.wornOut ? 'gray' : null) as RowTone })), { freeze: true, filter: true, totalLabel: 'Весь инвентарь' });

  // ── 13. Журнал изменений ──
  const s12 = newSheet(wb, 'Журнал изменений', 'FF6B7380');
  r = sheetTitle(s12, 1, `Журнал изменений — ${input.activity.length} записей`, 'Всё, что меняли в «Финансах», от новых к старым. Удаления подсвечены.');
  table(s12, r, [
    { header: 'Когда', key: 'at', width: 16, type: 'datetime' }, { header: 'Кто', key: 'user', width: 20 }, { header: 'Действие', key: 'action', width: 28 },
    { header: 'Объект', key: 'object', width: 26 }, { header: 'Было', key: 'before', width: 50, type: 'wrap' },
    { header: 'Стало', key: 'after', width: 50, type: 'wrap' }, { header: 'Что отправили', key: 'input', width: 40, type: 'wrap' },
    { header: 'Запрос', key: 'route', width: 30 },
  ], input.activity.map(a => ({ at: xLocal(a.at), user: a.user, action: a.action, object: a.object, before: a.before, after: a.after,
    input: a.input, route: a.route,
    _tone: (/удал/i.test(a.action) || /^DELETE /.test(a.route || '') ? 'warn' : null) as RowTone })), { freeze: true, filter: true });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
