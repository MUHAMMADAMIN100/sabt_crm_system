/**
 * «Компас компании» — чистые правила без базы (16.11.2026,
 * docs/GOALS_SPEC.md §5): окно месяца, неделя, прогресс, темп, статус,
 * сводный статус и форматирование цифр для текстов. Все даты — календарные
 * дни по Душанбе в виде YYYY-MM-DD (сервер живёт в UTC).
 */
import type { CheckinStatus, GoalStatus, KrKind, KrUnit } from './goals.types';

export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYm(v: unknown): v is string {
  return typeof v === 'string' && YM_RE.test(v);
}

/** Сегодня по Душанбе. */
export function todayDushanbe(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(now);
}

export const ymOf = (iso: string) => iso.slice(0, 7);

export function daysInMonth(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

export const monthStart = (ym: string) => `${ym}-01`;

export function monthEnd(ym: string): string {
  return `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
}

export function shiftYm(ym: string, delta: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Разница в днях b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** День недели: 1 — понедельник … 7 — воскресенье. */
export function dayOfWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Понедельник недели, в которую входит день. */
export function weekStart(iso: string): string {
  return addDays(iso, -(dayOfWeek(iso) - 1));
}

/** Какая доля месяца прошла: прошедший — 1, будущий — 0, текущий — день/дней. */
export function elapsed(ym: string, today: string): number {
  const cur = ymOf(today);
  if (ym < cur) return 1;
  if (ym > cur) return 0;
  return Number(today.slice(8, 10)) / daysInMonth(ym);
}

/** Дней до конца месяца: прошедший — 0, текущий — до последнего дня. */
export function daysLeft(ym: string, today: string): number {
  const cur = ymOf(today);
  if (ym < cur) return 0;
  return Math.max(0, daysBetween(today, monthEnd(ym)));
}

export interface DayWindow {
  from: string;
  to: string;
}

/** Окно подсчёта месяца: с 1-го по min(конец месяца, сегодня). Будущий — null. */
export function monthWindow(ym: string, today: string): DayWindow | null {
  const from = monthStart(ym);
  if (from > today) return null;
  const end = monthEnd(ym);
  return { from, to: end < today ? end : today };
}

/** Окно «неделю назад» для тренда: to − 7 дней, если не раньше начала. */
export function trendWindow(win: DayWindow | null): DayWindow | null {
  if (!win) return null;
  const to = addDays(win.to, -7);
  return to >= win.from ? { from: win.from, to } : null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Прогресс для полосы (0–100+). Меньше — лучше: в норме — 100, иначе
 *  target/value. Нет данных или цели — null. */
export function progressOf(kind: KrKind, value: number | null | undefined, target: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const t = Number(target);
  if (!(t > 0)) return null;
  if (kind === 'lower') return v <= t ? 100 : round1((t / v) * 100);
  return round1((v / t) * 100);
}

/** Черта темпа на полосе: только kind=sum текущего месяца. */
export function paceOf(kind: KrKind, ym: string, today: string): number | null {
  if (kind !== 'sum' || ym !== ymOf(today)) return null;
  return round1(elapsed(ym, today) * 100);
}

/** Первые дни месяца, когда «копящиеся» цифры ещё не показательны. */
export const GRACE_DAYS = 5;

export interface StatusInput {
  kind: KrKind;
  unit: KrUnit;
  /** manual — статус по отметке недели. */
  source: string;
  value: number | null | undefined;
  target: number;
  ym: string;
  today: string;
  /** Отметка недели — для manual. */
  lastCheckin?: CheckinStatus | null;
}

/** Автоматический статус результата (§5). */
export function statusOf(i: StatusInput): GoalStatus {
  if (i.value === null || i.value === undefined || !Number.isFinite(Number(i.value))) return 'none';
  const value = Number(i.value);
  const target = Number(i.target) || 0;
  const cur = ymOf(i.today);
  const past = i.ym < cur;
  const future = i.ym > cur;

  if (i.source === 'manual') {
    if (value >= target) return 'done';
    if (past) return 'missed';
    return i.lastCheckin || 'none';
  }

  if (i.kind === 'sum') {
    if (past) return value >= target ? 'done' : 'missed';
    if (value >= target || future) return 'on_track';
    if (Number(i.today.slice(8, 10)) <= GRACE_DAYS) return 'on_track';
    const e = elapsed(i.ym, i.today);
    const ratio = target * e > 0 ? value / (target * e) : 1;
    if (ratio >= 0.9) return 'on_track';
    if (ratio >= 0.7) return 'at_risk';
    return 'off_track';
  }

  // Допуск «риска»: у процентов — 3 п., у остального — 5 % от цели.
  const tol = i.unit === 'percent' ? 3 : target * 0.05;
  if (i.kind === 'rate') {
    if (past) return value >= target ? 'done' : 'missed';
    if (value >= target) return 'on_track';
    if (value >= target - tol) return 'at_risk';
    return 'off_track';
  }
  // lower — меньше лучше.
  if (past) return value <= target ? 'done' : 'missed';
  if (value <= target) return 'on_track';
  if (value <= target + tol) return 'at_risk';
  return 'off_track';
}

/** Порядок «хуже → лучше» для сводного статуса. */
export const STATUS_SEVERITY: Record<GoalStatus, number> = {
  off_track: 5, missed: 5, at_risk: 4, on_track: 3, done: 2, none: 1,
};

/** Сводный статус цели/отдела — худший из статусов КР; пусто — none. */
export function worstStatus(list: GoalStatus[]): GoalStatus {
  return (list || []).reduce<GoalStatus>((w, s) => (STATUS_SEVERITY[s] > STATUS_SEVERITY[w] ? s : w), 'none');
}

/** Сколько КР в каждом статусе. */
export function countStatuses(list: GoalStatus[]): Partial<Record<GoalStatus, number>> {
  const out: Partial<Record<GoalStatus, number>> = {};
  for (const s of list || []) out[s] = (out[s] || 0) + 1;
  return out;
}

/** «По результатам отделов»: среднее progress (с потолком 100) привязанных
 *  КР отделов, у которых есть данные; нет таких — null. */
export function rollupValue(progresses: Array<number | null | undefined>): number | null {
  const list = (progresses || []).filter((p): p is number => p !== null && p !== undefined && Number.isFinite(Number(p)));
  if (!list.length) return null;
  return round1(list.reduce((s, p) => s + Math.min(100, Math.max(0, Number(p))), 0) / list.length);
}

/** Понедельники недель месяца (неделя задевает месяц), не позже текущей
 *  недели; последние count штук по возрастанию. */
export function monthWeeks(ym: string, today: string, count = 5): string[] {
  const current = weekStart(today);
  const end = monthEnd(ym);
  const out: string[] = [];
  for (let m = weekStart(monthStart(ym)); m <= end; m = addDays(m, 7)) {
    if (m > current) break;
    out.push(m);
  }
  return out.slice(-count);
}

// ─── Тексты ──────────────────────────────────────────────────────────────

/** Русское число: 1 клиент, 2 клиента, 5 клиентов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Число с пробелами между разрядами: 141 000; дробь — через запятую. */
export function fmtNum(n: number, digits = 0): string {
  const f = 10 ** digits;
  const r = Math.round(Math.abs(n) * f) / f;
  const [int, frac] = r.toFixed(digits).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const tail = frac && /[1-9]/.test(frac) ? `,${frac.replace(/0+$/, '')}` : '';
  return `${n < 0 && r !== 0 ? '−' : ''}${grouped}${tail}`;
}

/** Значение результата: «141 000 с.», «93 %», «11». */
export function fmtValue(value: number | null | undefined, unit: KrUnit): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  if (unit === 'money') return `${fmtNum(v)} с.`;
  if (unit === 'percent') return `${fmtNum(v, 1)} %`;
  return fmtNum(v, 1);
}

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «ноябрь 2026». */
export function monthName(ym: string): string {
  return `${MONTHS_NOM[Number(ym.slice(5, 7)) - 1] || ''} ${ym.slice(0, 4)}`;
}

/** «25 ноября». */
export function dayName(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1] || ''}`;
}
