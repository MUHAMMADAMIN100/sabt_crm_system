import { LOST_REASONS, STAGE_PROBABILITY } from '../clients/client-lead.entity';
import { addDaysIso, dushanbeDay, dushanbeDayEnd, dushanbeDayStart } from '../clients/sales-kpi.logic';

/**
 * Аналитика продаж (15.11.2026, SALES_SPEC §5 GET /sales/analytics) — вся
 * математика здесь, чистыми функциями. Сервис только достаёт строки из базы.
 *
 * «Лиды периода» — созданные в периоде. «Дошёл до этапа» — текущий этап не
 * ниже или веха в lead_progress (status_to / stage_to). Этапы онбординга
 * эквивалентны этапам воронки (SALES_SPEC §1): negotiation ≡ waiting,
 * meeting ≡ meeting, kp_creation ≡ proposal, contract ≡ contract,
 * implementation ≡ won. Дошедший до этапа дошёл и до всех предыдущих.
 */

export const FUNNEL_STAGES = ['new', 'waiting', 'meeting', 'proposal', 'contract', 'won'] as const;
export type FunnelStage = typeof FUNNEL_STAGES[number];

/** Ранг текущего статуса; lost = −1 (до чего дошёл — знают только вехи).
 *  Устаревшие: negotiating, on_hold → «Контакт», unknown → «Новый». */
const STATUS_RANK: Record<string, number> = {
  new: 0, unknown: 0,
  waiting: 1, negotiating: 1, on_hold: 1,
  meeting: 2, proposal: 3, contract: 4, won: 5,
  lost: -1,
};
/** Ранг этапа онбординга в вехах lead_progress.stage_to. */
const STAGE_RANK: Record<string, number> = {
  negotiation: 1, meeting: 2, kp_creation: 3, contract: 4, implementation: 5,
};

/** Активные этапы (для прогноза «Ожидается»). */
const ACTIVE = ['new', 'unknown', 'waiting', 'negotiating', 'on_hold', 'meeting', 'proposal', 'contract'];

export const NO_SOURCE = 'Не указан';

export interface CohortLead {
  id: string;
  status: string;
  ownerId?: string | null;
  leadSource?: string | null;
}

export interface Milestone {
  leadId: string;
  statusTo?: string | null;
  stageTo?: string | null;
}

/** Доля в процентах с одним знаком; от нуля — 0. */
export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Самый дальний этап лида: текущий статус или веха. Любой лид периода
 *  «дошёл» до «Новый» (ранг 0) — даже проигранный. */
export function reachedRank(status: string, milestones: Milestone[] = []): number {
  let r = Math.max(0, STATUS_RANK[String(status)] ?? 0);
  for (const m of milestones) {
    const a = m.statusTo ? STATUS_RANK[String(m.statusTo)] : undefined;
    const b = m.stageTo ? STAGE_RANK[String(m.stageTo)] : undefined;
    if (a !== undefined && a > r) r = a;
    if (b !== undefined && b > r) r = b;
  }
  return r;
}

export function groupMilestones(rows: Milestone[]): Map<string, Milestone[]> {
  const out = new Map<string, Milestone[]>();
  for (const m of rows || []) {
    if (!m?.leadId) continue;
    const list = out.get(m.leadId);
    if (list) list.push(m); else out.set(m.leadId, [m]);
  }
  return out;
}

export interface FunnelRow { status: FunnelStage; count: number; conversionFromPrev: number | null }

/** Воронка периода: сколько лидов дошло до каждого этапа и переход от
 *  предыдущего (у первого и при нуле на предыдущем — null). */
export function buildFunnel(leads: CohortLead[], milestones: Map<string, Milestone[]>): FunnelRow[] {
  const ranks = (leads || []).map(l => reachedRank(l.status, milestones.get(l.id)));
  const rows: FunnelRow[] = [];
  FUNNEL_STAGES.forEach((status, i) => {
    const count = ranks.filter(r => r >= i).length;
    const prev = i > 0 ? rows[i - 1].count : 0;
    rows.push({ status, count, conversionFromPrev: i === 0 || prev === 0 ? null : pct(count, prev) });
  });
  return rows;
}

const isWon = (l: CohortLead) => String(l.status) === 'won';

export interface SourceRow { source: string; leads: number; won: number; conversion: number }

/** По источникам: пусто → «Не указан»; «Instagram» и «instagram » — один
 *  источник (подпись — как написали первым). Больше лидов — выше. */
export function bySource(leads: CohortLead[]): SourceRow[] {
  const map = new Map<string, SourceRow>();
  for (const l of leads || []) {
    const label = String(l.leadSource ?? '').trim() || NO_SOURCE;
    const key = label.toLocaleLowerCase('ru');
    const row = map.get(key) ?? { source: label, leads: 0, won: 0, conversion: 0 };
    row.leads += 1;
    if (isWon(l)) row.won += 1;
    map.set(key, row);
  }
  return [...map.values()]
    .map(r => ({ ...r, conversion: pct(r.won, r.leads) }))
    .sort((a, b) => b.leads - a.leads || b.won - a.won || a.source.localeCompare(b.source, 'ru'));
}

export function median(values: number[]): number | null {
  const v = (values || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Дней между датами по календарю Душанбе (создан сегодня, выигран
 *  сегодня — 0). */
export function dushanbeDaysBetween(a: Date | string, b: Date | string): number {
  const da = dushanbeDay(new Date(a));
  const db = dushanbeDay(new Date(b));
  return Math.round((Date.parse(`${db}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

/** Медиана цикла сделки: дни от создания до выигрыша — для лидов,
 *  выигранных в периоде [fromIso, toIso] (по Душанбе). */
export function cycleDaysMedian(
  rows: Array<{ createdAt: Date | string; wonAt: Date | string | null }>,
  fromIso: string,
  toIso: string,
): number | null {
  const start = dushanbeDayStart(fromIso).getTime();
  const end = dushanbeDayEnd(toIso).getTime();
  const days: number[] = [];
  for (const r of rows || []) {
    if (!r?.wonAt || !r.createdAt) continue;
    const t = new Date(r.wonAt).getTime();
    if (!Number.isFinite(t) || t < start || t > end) continue;
    days.push(Math.max(0, dushanbeDaysBetween(r.createdAt, r.wonAt)));
  }
  return median(days);
}

/** Причины проигрыша: неизвестный код или пусто — «Другое». Частые — выше. */
export function lostReasonCounts(rows: Array<{ lostReason?: string | null }>): Array<{ reason: string; count: number }> {
  const known = new Set<string>(LOST_REASONS as readonly string[]);
  const map = new Map<string, number>();
  for (const r of rows || []) {
    const reason = known.has(String(r?.lostReason)) ? String(r.lostReason) : 'other';
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  const order = LOST_REASONS as readonly string[];
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.reason) - order.indexOf(b.reason));
}

/** Сумма; все null — null (нечего показывать, а не «0 с.»). */
export function sumOrNull(values: Array<number | null | undefined>): number | null {
  const v = (values || []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (!v.length) return null;
  return Math.round(v.reduce((s, n) => s + n, 0) * 100) / 100;
}

/**
 * «Ожидается»: Σ потенциал × вероятность / 100 по активным лидам, чья
 * ожидаемая дата закрытия (expectedCloseAt) попадает в период. Вероятность —
 * своя у лида или по этапу. Нет ни одного такого лида — null.
 */
export function expectedInPeriod(
  rows: Array<{ status: string; dealPotential?: number | string | null; probability?: number | null; expectedCloseAt?: string | Date | null }>,
  fromIso: string,
  toIso: string,
): number | null {
  let sum = 0;
  let any = false;
  for (const r of rows || []) {
    if (!ACTIVE.includes(String(r.status)) || !r.expectedCloseAt) continue;
    const day = typeof r.expectedCloseAt === 'string'
      ? r.expectedCloseAt.slice(0, 10)
      : dushanbeDay(new Date(r.expectedCloseAt));
    if (day < fromIso || day > toIso) continue;
    const potential = Number(r.dealPotential);
    if (!Number.isFinite(potential) || potential <= 0) continue;
    const p = r.probability === null || r.probability === undefined || !Number.isFinite(Number(r.probability))
      ? (STAGE_PROBABILITY[String(r.status)] ?? 0)
      : Number(r.probability);
    sum += (potential * Math.min(100, Math.max(0, p))) / 100;
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

const monthEndIso = (iso: string): string => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

export const MAX_PLAN_MONTHS = 12;

/**
 * Месяцы периода для «Получено / План». План и «получено» в CRM — помесячные
 * (sales_plans, SmmPaymentsService.receivedOf), поэтому считаем их только для
 * периода из целых месяцев: с 1-го числа по последнее. Текущий месяц можно
 * брать до сегодня — оплат «из будущего» не бывает. Иначе (неделя, середина
 * месяца) — null: честнее не показать, чем показать деньги чужих дней.
 */
export function wholeMonths(fromIso: string, toIso: string, todayIso: string): string[] | null {
  if (!fromIso || !toIso || fromIso > toIso || fromIso.slice(8, 10) !== '01') return null;
  const toYm = toIso.slice(0, 7);
  const endsMonth = toIso === monthEndIso(toIso) || (toYm === todayIso.slice(0, 7) && toIso >= todayIso);
  if (!endsMonth) return null;
  const out: string[] = [];
  for (let d = fromIso; d.slice(0, 7) <= toYm && out.length <= MAX_PLAN_MONTHS; d = addDaysIso(monthEndIso(d), 1)) {
    out.push(d.slice(0, 7));
  }
  return out.length > MAX_PLAN_MONTHS ? null : out;
}
