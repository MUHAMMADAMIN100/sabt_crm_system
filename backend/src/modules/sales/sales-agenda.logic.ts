import { addDaysIso, dushanbeDay, dushanbeDayStart } from '../clients/sales-kpi.logic';

/**
 * «Сегодня» менеджера продаж (15.11.2026, SALES_SPEC §5 GET /sales/agenda).
 * Чистая функция: лиды + «сейчас» → четыре ленты. Дни — по Душанбе (UTC+5
 * круглый год, без перевода часов), сервер живёт в UTC.
 *
 *  - meeting   — назначенная встреча (nextContactAt) без итога (meetingResult);
 *  - callback  — повторный звонок (repeatCallAt);
 *  - next_step — срок следующего шага (nextStepAt), note = текст шага;
 *  - просрочено — время уже прошло (даже сегодняшнее утро); сегодня и
 *    завтра — ещё впереди, по дню Душанбе; дальше завтра — не показываем;
 *  - attention — лиды, которых нет в лентах выше: без единого запланированного
 *    действия (no_step) и без касания 7+ дней (stale), по 20 штук, at = null.
 *    Лид с просроченным действием уже стоит в «Просрочено» — второй раз его
 *    в «Требует внимания» не ставим, иначе один лид — две строки.
 *  - только активные этапы (new…contract; устаревшие negotiating/unknown
 *    считаются «Контакт»/«Новый»), «На паузе» — пропускаем.
 */

export type AgendaKind = 'meeting' | 'callback' | 'next_step' | 'no_step' | 'stale';

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  /** ISO; null у no_step / stale. */
  at: string | null;
  leadId: string;
  leadName: string;
  status: string;
  onHold: boolean;
  note: string | null;
  phone: string | null;
  potential: number | null;
}

export interface Agenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  tomorrow: AgendaItem[];
  attention: AgendaItem[];
}

/** Поля лида, нужные «Сегодня». Даты — Date или строка из базы. */
export interface AgendaLead {
  id: string;
  name?: string | null;
  status: string;
  onHold?: boolean | null;
  nextContactAt?: Date | string | null;
  meetingResult?: string | null;
  repeatCallAt?: Date | string | null;
  nextStepAt?: Date | string | null;
  nextStep?: string | null;
  contactPhone?: string | null;
  dealPotential?: number | string | null;
  lastActivityAt?: Date | string | null;
  /** Колонка date: из базы приходит строкой YYYY-MM-DD. */
  lastContactAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** Активные этапы воронки (устаревшие — как их новые двойники). */
export const AGENDA_ACTIVE_STATUSES = ['new', 'waiting', 'meeting', 'proposal', 'contract', 'negotiating', 'unknown'];
export const ATTENTION_LIMIT = 20;
export const STALE_DAYS = 7;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const timeOf = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  // Голая дата (колонка date) — начало дня по Душанбе, а не полночь UTC.
  const d = typeof v === 'string' && ISO_DAY.test(v) ? dushanbeDayStart(v) : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
};

const potentialOf = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Последнее касание: активность, контакт или (у нетронутого) создание. */
export function lastTouchOf(l: AgendaLead): number | null {
  const ts = [timeOf(l.lastActivityAt), timeOf(l.lastContactAt), timeOf(l.createdAt)]
    .filter((t): t is number => t !== null);
  return ts.length ? Math.max(...ts) : null;
}

/** Запланированные действия лида: встреча без итога, перезвон, шаг. */
function actionsOf(l: AgendaLead): Array<{ kind: 'meeting' | 'callback' | 'next_step'; at: number; note: string | null }> {
  const out: Array<{ kind: 'meeting' | 'callback' | 'next_step'; at: number; note: string | null }> = [];
  const meet = timeOf(l.nextContactAt);
  if (meet !== null && !l.meetingResult) out.push({ kind: 'meeting', at: meet, note: null });
  const call = timeOf(l.repeatCallAt);
  if (call !== null) out.push({ kind: 'callback', at: call, note: null });
  const step = timeOf(l.nextStepAt);
  if (step !== null) out.push({ kind: 'next_step', at: step, note: (l.nextStep || '').trim() || null });
  return out;
}

export function buildAgenda(leads: AgendaLead[], now: Date): Agenda {
  const nowMs = now.getTime();
  const todayIso = dushanbeDay(now);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const agenda: Agenda = { overdue: [], today: [], tomorrow: [], attention: [] };
  const noStep: Array<{ item: AgendaItem; touch: number }> = [];
  const stale: Array<{ item: AgendaItem; touch: number }> = [];

  for (const l of leads || []) {
    if (!l || !AGENDA_ACTIVE_STATUSES.includes(String(l.status))) continue;
    if (l.onHold) continue;
    const base = {
      leadId: l.id,
      leadName: String(l.name || '').trim() || 'Клиент',
      status: String(l.status),
      onHold: !!l.onHold,
      phone: (l.contactPhone || '').trim() || null,
      potential: potentialOf(l.dealPotential),
    };
    let inTimeline = false;
    let hasFuture = false;
    for (const a of actionsOf(l)) {
      const item: AgendaItem = { ...base, id: `${a.kind}:${l.id}`, kind: a.kind, at: new Date(a.at).toISOString(), note: a.note };
      if (a.at < nowMs) {
        agenda.overdue.push(item);
        inTimeline = true;
        continue;
      }
      hasFuture = true;
      const day = dushanbeDay(new Date(a.at));
      if (day === todayIso) { agenda.today.push(item); inTimeline = true; }
      else if (day === tomorrowIso) { agenda.tomorrow.push(item); inTimeline = true; }
    }
    if (inTimeline) continue;

    const touch = lastTouchOf(l) ?? 0;
    if (!hasFuture) {
      noStep.push({ item: { ...base, id: `no_step:${l.id}`, kind: 'no_step', at: null, note: null }, touch });
    } else if (nowMs - touch >= STALE_DAYS * DAY_MS) {
      // Действие есть, но дальше завтрашнего дня, а с клиентом неделю тишина.
      stale.push({ item: { ...base, id: `stale:${l.id}`, kind: 'stale', at: null, note: null }, touch });
    }
  }

  const byAt = (a: AgendaItem, b: AgendaItem) =>
    (a.at as string).localeCompare(b.at as string) || a.leadName.localeCompare(b.leadName, 'ru');
  agenda.overdue.sort(byAt);
  agenda.today.sort(byAt);
  agenda.tomorrow.sort(byAt);
  // Самых забытых — первыми.
  const byTouch = (a: { item: AgendaItem; touch: number }, b: { item: AgendaItem; touch: number }) =>
    a.touch - b.touch || a.item.leadName.localeCompare(b.item.leadName, 'ru');
  agenda.attention = [
    ...noStep.sort(byTouch).slice(0, ATTENTION_LIMIT).map(x => x.item),
    ...stale.sort(byTouch).slice(0, ATTENTION_LIMIT).map(x => x.item),
  ];
  return agenda;
}
