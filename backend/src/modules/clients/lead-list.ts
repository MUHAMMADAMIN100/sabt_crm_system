/**
 * Список лидов с серверной пагинацией и доска (15.11.2026, SALES_SPEC §4).
 * Чистая часть — разбор параметров и «ближайшее действие» лида: их же
 * повторяет SQL в ClientsService.list(), а тесты проверяют здесь.
 */
import { ClientLeadStatus } from './client-lead.entity';
import { dushanbeDay, dushanbeDayEnd } from './sales-kpi.logic';

/** Активные этапы (new…contract) + устаревшие значения из старых данных,
 *  которые показываются как «Новый» / «Контакт». */
export const ACTIVE_STATUSES: readonly string[] = [
  ClientLeadStatus.NEW, ClientLeadStatus.WAITING, ClientLeadStatus.MEETING,
  ClientLeadStatus.PROPOSAL, ClientLeadStatus.CONTRACT,
  ClientLeadStatus.NEGOTIATING, ClientLeadStatus.ON_HOLD, ClientLeadStatus.UNKNOWN,
];

/** Фильтр по этапу: устаревшие значения входят в тот этап, которым их
 *  показываем (negotiating, on_hold → «Контакт»; unknown → «Новый») — если
 *  где-то миграция 1835 ещё не прошла, лид не пропадает из фильтра. */
export function statusVariants(status: string): string[] {
  if (status === ClientLeadStatus.WAITING) return [status, ClientLeadStatus.NEGOTIATING, ClientLeadStatus.ON_HOLD];
  if (status === ClientLeadStatus.NEW) return [status, ClientLeadStatus.UNKNOWN];
  return [status];
}

/** «status=new,waiting» → все значения enum для SQL (неизвестные — мимо). */
export function parseStatusList(raw?: string | null): string[] {
  const known = new Set<string>(Object.values(ClientLeadStatus));
  const out = new Set<string>();
  for (const part of String(raw || '').split(',')) {
    const s = part.trim();
    if (known.has(s)) statusVariants(s).forEach(v => out.add(v));
  }
  return [...out];
}

export type LeadDue = 'overdue' | 'today' | 'none';
export type LeadSort = 'next' | 'updated' | 'created' | 'potential';

export interface LeadActionFields {
  status?: string | null;
  onHold?: boolean | null;
  nextContactAt?: Date | string | null;
  meetingResult?: string | null;
  repeatCallAt?: Date | string | null;
  nextStepAt?: Date | string | null;
}

const ms = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Сроки действий лида: встреча (если по ней ещё нет итога), перезвон,
 *  следующий шаг. Встреча с итогом («состоялась»/«не состоялась») — уже не
 *  дело на будущее. */
function actionTimes(l: LeadActionFields): number[] {
  return [
    l.meetingResult ? null : ms(l.nextContactAt),
    ms(l.repeatCallAt),
    ms(l.nextStepAt),
  ].filter((t): t is number => t !== null);
}

/** «Ближайшее действие» = min(встреча без итога, перезвон, шаг). */
export function nextActionAt(l: LeadActionFields): Date | null {
  const t = actionTimes(l);
  return t.length ? new Date(Math.min(...t)) : null;
}

export const isActiveStatus = (s?: string | null) => ACTIVE_STATUSES.includes(String(s || ''));

/** Попадает ли лид в чип «Просрочено» / «Сегодня» / «Без шага».
 *  Только активные этапы и не «на паузе» — как лента «Сегодня»: у
 *  выигранного, проигранного и поставленного на паузу дел нет.
 *   overdue — ближайшее действие уже в прошлом;
 *   today   — ещё не наступило, но сегодня по Душанбе (просроченное
 *             сегодняшнее — в overdue, как в ленте «Сегодня»);
 *   none    — ни одного действия в будущем. */
export function matchesDue(l: LeadActionFields, due: LeadDue, now: Date): boolean {
  if (!isActiveStatus(l.status) || l.onHold) return false;
  const times = actionTimes(l);
  const t = now.getTime();
  if (due === 'none') return !times.some(x => x >= t);
  if (!times.length) return false;
  const next = Math.min(...times);
  if (due === 'overdue') return next < t;
  return next >= t && next <= dushanbeDayEnd(dushanbeDay(now)).getTime();
}

/** SQL «ближайшего действия» — то же, что nextActionAt (LEAST пропускает NULL). */
export const NEXT_ACTION_SQL =
  `LEAST(CASE WHEN c."meetingResult" IS NULL THEN c."nextContactAt" END, c."repeatCallAt", c."nextStepAt")`;
/** Самое дальнее действие — для «Без шага» (нет ни одного в будущем). */
export const LAST_ACTION_SQL =
  `GREATEST(CASE WHEN c."meetingResult" IS NULL THEN c."nextContactAt" END, c."repeatCallAt", c."nextStepAt")`;

export interface LeadListQuery {
  search?: string;
  status?: string;
  interest?: string;
  sphere?: string;
  source?: string;
  owner?: string;
  due?: string;
  hold?: string;
  page?: string | number;
  pageSize?: string | number;
  sort?: string;
}

export interface LeadListParams {
  search: string | null;
  statuses: string[];
  interest: string | null;
  sphere: string | null;
  source: string | null;
  /** 'all' — без фильтра; 'none' — без владельца; иначе id владельца. */
  owner: string;
  due: LeadDue | null;
  hold: boolean | null;
  page: number;
  pageSize: number;
  sort: LeadSort;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 200) : null;
};
const int = (v: unknown, def: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : def;
};

/** Разбор параметров /clients/list и /clients/board. owner по умолчанию —
 *  «me» для менеджера продаж, «all» для руководства. Неизвестный owner —
 *  как по умолчанию, а не ошибка: ссылку со старым параметром не ломаем. */
export function parseLeadListQuery(q: LeadListQuery, me: { id: string; isSales: boolean }): LeadListParams {
  const rawOwner = String(q.owner ?? '').trim();
  let owner = me.isSales ? me.id : 'all';
  if (rawOwner === 'me') owner = me.id;
  else if (rawOwner === 'all' || rawOwner === 'none') owner = rawOwner;
  else if (UUID_RE.test(rawOwner)) owner = rawOwner;
  const due = (['overdue', 'today', 'none'] as const).find(d => d === q.due) ?? null;
  const sort = (['next', 'updated', 'created', 'potential'] as const).find(s => s === q.sort) ?? 'next';
  const holdRaw = String(q.hold ?? '');
  return {
    search: str(q.search),
    statuses: parseStatusList(q.status),
    interest: str(q.interest),
    sphere: str(q.sphere),
    source: str(q.source),
    owner,
    due,
    hold: holdRaw === '1' ? true : holdRaw === '0' ? false : null,
    page: Math.max(1, int(q.page, 1)),
    pageSize: Math.min(100, Math.max(10, int(q.pageSize, 20))),
    sort,
  };
}
