/**
 * Честный KPI менеджера продаж (14.11.2026, решения владельца).
 *  · Рабочие дни — пн–сб по календарю Душанбе. Норма = дневная × рабочие
 *    дни периода, которые уже наступили; дни отпуска и отметок табеля
 *    (отгул, больничный) в норму не идут. Работа в воскресенье — в факт.
 *  · Будущее не считаем: период обрезается концом сегодняшнего дня.
 *  · Нет ни одного рабочего дня — «выходной»: нормы 0, процента нет.
 *  · В общем проценте каждый пункт не больше 100 %: 60 звонков при нуле
 *    остального — не «60 %».
 */

/** Дневные нормы KPI менеджера продаж (план на ОДИН рабочий день) — по
 *  умолчанию. С 15.11.2026 нормы задаёт руководство по направлениям
 *  (sales_settings, см. sales-settings.ts); эти числа — когда настроек нет. */
export const SALES_DAILY_TARGETS = {
  funnel_progress: 20,
  new_companies:   15,
  cold_calls:      20,
  personal_emails: 10,
  meetings:        2,
} as const;

export type SalesKpiKey = keyof typeof SALES_DAILY_TARGETS;

const LABELS: Record<SalesKpiKey, string> = {
  funnel_progress: 'Продвижения по воронке',
  new_companies:   'Новые компании в базе',
  // «Звонки» (15.11.2026): звонок пишется из шторки «Звонок» любого типа,
  // а не только «холодный» — подпись как в макете. Ключ метрики прежний.
  cold_calls:      'Звонки',
  personal_emails: 'Персональные письма',
  meetings:        'Встречи / созвоны',
};
const ORDER: SalesKpiKey[] = ['funnel_progress', 'new_companies', 'cold_calls', 'personal_emails', 'meetings'];

/** События «холодный звонок» пишутся с 16.06.2026 (1e8b8cd). У периодов,
 *  целиком закончившихся раньше, событий нет вовсе — там остаётся старый
 *  счёт по состоянию лидов, иначе прошлые месяцы обнулились бы. */
export const COLD_CALL_EVENTS_SINCE = '2026-06-16';

export const DUSHANBE_TZ = 'Asia/Dushanbe';

/** Дата YYYY-MM-DD по Душанбе — сервер живёт в UTC. */
export function dushanbeDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DUSHANBE_TZ }).format(d);
}

/** Начало и конец суток по Душанбе: UTC+5 круглый год, без перевода часов. */
export const dushanbeDayStart = (iso: string) => new Date(`${iso}T00:00:00+05:00`);
export const dushanbeDayEnd = (iso: string) => new Date(`${iso}T23:59:59.999+05:00`);

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Пн–сб — рабочие, воскресенье — выходной. */
export function isWorkday(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Защита от «с 0001 года»: дальше двадцати лет дни не перебираем. */
const MAX_DAYS = 366 * 20;

export interface SalesPeriod {
  /** Сегодня по Душанбе. */
  todayIso: string;
  /** Запрошенные границы, YYYY-MM-DD (пусто — сегодня). */
  fromIso: string;
  toIso: string;
  /** Последний день, который уже наступил: min(to, сегодня). */
  countedToIso: string;
  /** Начало первого и конец последнего дня периода по Душанбе. */
  start: Date;
  end: Date;
  /** До какого момента считаем факт: min(конец периода, сейчас). */
  until: Date;
}

/** Границы периода KPI по Душанбе с обрезкой будущего. */
export function salesPeriod(from: string | undefined, to: string | undefined, now: Date): SalesPeriod {
  const todayIso = dushanbeDay(now);
  const fromIso = from && ISO_DAY.test(from) ? from : todayIso;
  const toIso = to && ISO_DAY.test(to) ? to : todayIso;
  const end = dushanbeDayEnd(toIso);
  return {
    todayIso,
    fromIso,
    toIso,
    countedToIso: toIso < todayIso ? toIso : todayIso,
    start: dushanbeDayStart(fromIso),
    end,
    until: end.getTime() < now.getTime() ? end : now,
  };
}

/** Отрезки «с — по» (отпуска) → дни внутри [fromIso, toIso]. Пустое «с» —
 *  отпуск уже шёл, пустое «по» — ещё идёт. */
export function expandRanges(
  ranges: Array<{ from?: string | null; until?: string | null }>,
  fromIso: string,
  toIso: string,
): string[] {
  const out: string[] = [];
  for (const r of ranges) {
    const a = r.from && r.from > fromIso ? r.from : fromIso;
    const b = r.until && r.until < toIso ? r.until : toIso;
    let d = a;
    for (let i = 0; d <= b && i < MAX_DAYS; i++, d = addDaysIso(d, 1)) out.push(d);
  }
  return out;
}

/** Текущий статус «В отпуске» из карточки сотрудника → отрезок отпуска
 *  (15.11.2026). Статус говорит лишь, что человек в отпуске СЕЙЧАС: без даты
 *  «с» отпуск считаем начавшимся сегодня. Раньше пустое «с» значило «шёл
 *  всегда» — и прошлый месяц целиком превращался в выходные, норма — в 0. */
export function currentVacationRange(
  row: { from?: string | null; until?: string | null },
  todayIso: string,
): { from: string; until: string | null } {
  const from = row.from && ISO_DAY.test(row.from) ? row.from : todayIso;
  const until = row.until && ISO_DAY.test(row.until) ? row.until : null;
  return { from, until };
}

/** Рабочие дни периода, которые уже наступили: пн–сб от fromIso до
 *  min(toIso, сегодня), без дней отпуска и отсутствий. */
export function workingDays(
  fromIso: string,
  toIso: string,
  todayIso: string,
  off: Iterable<string> = [],
): string[] {
  const offSet = off instanceof Set ? off as Set<string> : new Set(off);
  const last = toIso < todayIso ? toIso : todayIso;
  const out: string[] = [];
  let d = fromIso;
  for (let i = 0; d <= last && i < MAX_DAYS; i++, d = addDaysIso(d, 1)) {
    if (isWorkday(d) && !offSet.has(d)) out.push(d);
  }
  return out;
}

export interface SalesKpiItem {
  key: SalesKpiKey;
  label: string;
  target: number;
  value: number;
  percent: number;
  done: boolean;
}

export interface SalesKpiResult {
  overallPercent: number;
  /** Ни одного рабочего дня (воскресенье, отпуск, период в будущем):
   *  нормы 0, общий процент не считается. */
  restDay: boolean;
  /** Сколько рабочих дней вошло в норму. */
  workDays: number;
  items: SalesKpiItem[];
}

/** Пункты KPI и общий процент. Норма = дневная × рабочие дни. Общий
 *  процент — среднее пунктов с нормой, каждый не больше 100 %.
 *  daily — дневные нормы направления менеджера (15.11.2026, из
 *  sales_settings); не передали — нормы по умолчанию. */
export function buildSalesKpi(
  facts: Record<SalesKpiKey, number>,
  workDays: number,
  daily: Readonly<Record<SalesKpiKey, number>> = SALES_DAILY_TARGETS,
): SalesKpiResult {
  const days = Math.max(0, Math.floor(workDays));
  const items = ORDER.map(key => {
    const perDay = Number(daily?.[key]);
    const target = (Number.isFinite(perDay) && perDay >= 0 ? perDay : SALES_DAILY_TARGETS[key]) * days;
    const value = Math.max(0, Number(facts[key]) || 0);
    return {
      key,
      label: LABELS[key],
      target,
      value,
      percent: target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0,
      // Без нормы пункт не «выполнен» — иначе в выходной 0 из 0 праздновался бы.
      done: target > 0 && value >= target,
    };
  });
  const counted = items.filter(i => i.target > 0);
  const overall = counted.length
    ? Math.round(counted.reduce((s, i) => s + Math.min(100, (i.value / i.target) * 100), 0) / counted.length)
    : 0;
  return {
    overallPercent: Math.min(100, Math.max(0, overall)),
    restDay: days === 0,
    workDays: days,
    items,
  };
}

/** Шаг воронки «вперёд» (15.11.2026): цель — реальный этап (порядок > 0) и
 *  выше исходного. Из терминального (lost, порядок −1) или «нулевого» (new,
 *  пусто) — вперёд к любому реальному. Назад и в терминальные — нет.
 *  Повторный заход на уже взятую вершину отсекает проверка вех в
 *  lead_progress (ClientsService). */
export function funnelStepIsForward(toOrder: number | undefined, fromOrder: number | undefined): boolean {
  const t = toOrder ?? 0;
  const f = Math.max(0, fromOrder ?? 0);
  return t > 0 && t > f;
}

/** Письмо засчитывается, когда «Письмо» стало «Написал». */
export function emailBecameSent(
  before: { emailStatus?: string | null } | null,
  after: { emailStatus?: string | null },
): boolean {
  const sent = (v?: string | null) => String(v || '').toLowerCase() === 'sent';
  return !sent(before?.emailStatus) && sent(after.emailStatus);
}

/** Порядок этапов единой воронки (15.11.2026) — для «шага вперёд».
 *  lost — терминальный (−1). Устаревшие значения — как то, во что их
 *  перенесла миграция 1835: negotiating ≡ waiting, unknown ≡ new;
 *  on_hold — «пауза», терминальный. */
export const FUNNEL_ORDER: Record<string, number> = {
  new:         0,
  waiting:     1,
  meeting:     2,
  proposal:    3,
  contract:    4,
  won:         5,
  lost:        -1,
  negotiating: 1,
  unknown:     0,
  on_hold:     -1,
};

/** Чем в lead_progress уже могла быть взята веха этапа (15.11.2026, единая
 *  воронка). Раньше было две воронки — статус и «этап онбординга»; веха,
 *  взятая старым этапом, повторно не засчитывается: meeting ≡ этап meeting,
 *  proposal ≡ kp_creation, contract ≡ contract, won ≡ implementation,
 *  waiting ≡ negotiation (и старый статус negotiating — его перенесли в
 *  waiting). */
export function milestoneEquivalents(status: string): { statuses: string[]; stages: string[] } {
  switch (status) {
    case 'waiting':  return { statuses: ['waiting', 'negotiating'], stages: ['negotiation'] };
    case 'meeting':  return { statuses: ['meeting'], stages: ['meeting'] };
    case 'proposal': return { statuses: ['proposal'], stages: ['kp_creation'] };
    case 'contract': return { statuses: ['contract'], stages: ['contract'] };
    case 'won':      return { statuses: ['won'], stages: ['implementation'] };
    default:         return { statuses: [status], stages: [] };
  }
}
