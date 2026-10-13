/** Сроки оплаты SMM-клиентов для ответственных менеджеров — чистая логика
 *  без базы (решение владельца 12.10.2026, вариант А).
 *
 *  Источник правды — плановые оплаты «Финансов»: менеджер видит те же сроки,
 *  что владелец, но без сумм. Ничего своего здесь не хранится: записали
 *  оплату в «Финансах» — у менеджера она стала «оплачено», следующий срок
 *  появился сам. Правила повторяют finance.service (smmAlert, авто-планы),
 *  чтобы «просрочено» у менеджера и у владельца значило одно и то же. */

export type PayState = 'late' | 'today' | 'wait' | 'paid';

/** Клиент «Финансов» (finance_projects) — только то, что нужно для сроков. */
export interface FinClient {
  id: string;
  name: string;
  direction: string | null;
  tariff: number;
  contractDate: string | null;
  cycleAnchor: string | null;
  archived: boolean;
  status: string | null;
}

/** Плановая оплата (finance_planned_payments) с датой получения. */
export interface FinPlan {
  id: string;
  projectId: string;
  ym: string;
  partNo: number;
  status: string;
  dueDate: string | null;
  amount: number;
  /** Дата операции, которой платёж получен (finance_transactions.date). */
  paidAt: string | null;
}

export interface PayItem {
  /** Устойчивый ключ — для списка и для события календаря. */
  key: string;
  /** День, в котором оплата стоит в календаре: срок; у полученной без срока —
   *  день получения. */
  date: string;
  dueDate: string | null;
  /** 1 — оплата цикла (или аванс), 2 — остаток. */
  partNo: number;
  state: PayState;
  paidAt: string | null;
}

/** Сколько дней полученная оплата ещё видна менеджеру как «оплачено». */
export const PAID_VISIBLE_DAYS = 7;

/** Название без регистра, «ё» и знаков — чтобы связать SMM-проект с клиентом в Финансах. */
export const nameKey = (s?: string | null) => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ').trim();

const ymOf = (iso: string) => iso.slice(0, 7);
const shiftYm = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const addDays = (iso: string, delta: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
/** День месяца оплаты (1..31) по дате-якорю. */
const dayOf = (iso?: string | null): number | null => {
  if (!iso || iso.length < 10) return null;
  const d = Number(iso.slice(8, 10));
  return Number.isFinite(d) && d > 0 ? d : null;
};
/** Дата оплаты в месяце с учётом его длины (31-е в феврале → 28/29-е). */
const dueInMonth = (ym: string, day: number) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

/** С клиента сейчас берут деньги: не архив, не пауза, не лид, не завершён
 *  (то же правило, что isEarningFinanceProject в «Финансах»). */
export const isEarning = (c: { archived?: boolean; status?: string | null }) =>
  !c.archived && !['lead', 'paused', 'done', 'archived'].includes(c.status || 'active');

/**
 * Связь «SMM-проект CRM → клиент Финансов». Общего ключа в базе нет, поэтому:
 *  1) явный выбор владельца в карточке проекта (smmData.financeProjectId);
 *  2) иначе совпадение названия — только однозначное, среди неархивных:
 *     два клиента с одним названием не связываем, лучше «срок не найден»,
 *     чем чужая оплата.
 */
export function resolveFinanceLinks<C extends { id: string; name: string; archived?: boolean }>(
  projects: Array<{ id: string; name: string; financeProjectId?: string | null }>,
  clients: C[],
): Map<string, { client: C; by: 'manual' | 'name' }> {
  const byId = new Map(clients.map(c => [c.id, c]));
  const live = clients.filter(c => !c.archived);
  const count = new Map<string, number>();
  for (const c of live) { const k = nameKey(c.name); count.set(k, (count.get(k) || 0) + 1); }
  const byName = new Map<string, C>();
  for (const c of live) { const k = nameKey(c.name); if (k && count.get(k) === 1) byName.set(k, c); }

  const out = new Map<string, { client: C; by: 'manual' | 'name' }>();
  for (const p of projects) {
    const manual = typeof p.financeProjectId === 'string' ? byId.get(p.financeProjectId) : undefined;
    if (manual) { out.set(p.id, { client: manual, by: 'manual' }); continue; }
    const named = byName.get(nameKey(p.name));
    if (named) out.set(p.id, { client: named, by: 'name' });
  }
  return out;
}

const ORDER: Record<PayState, number> = { late: 0, today: 1, wait: 2, paid: 3 };
/** Сначала просроченные (самые давние), потом сегодня, ближайшие и в конце
 *  оплаченные (свежие первыми). */
export const byUrgency = (a: PayItem, b: PayItem) =>
  ORDER[a.state] - ORDER[b.state]
  || (a.state === 'paid' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))
  || a.key.localeCompare(b.key);

/**
 * Оплаты одного клиента, которые сейчас важны менеджеру:
 *  • каждая ожидаемая оплата со сроком — просрочена / сегодня / ждём;
 *  • оплаты, полученные за последние PAID_VISIBLE_DAYS дней, — «оплачено»;
 *  • у клиента без ожидаемых планов (новый, ещё ни разу не платил) срок
 *    считается по дню договора — как календарный фолбэк в «Финансах».
 */
export function paymentItems(client: FinClient, plans: FinPlan[], today: string, paidDays = PAID_VISIBLE_DAYS): PayItem[] {
  if (!isEarning(client)) return [];
  const mine = plans.filter(x => x.projectId === client.id);
  const stateOf = (due: string): PayState => (due < today ? 'late' : due === today ? 'today' : 'wait');
  const items: PayItem[] = [];

  const expected = mine.filter(x => x.status === 'expected' && !!x.dueDate);
  for (const x of expected) {
    const due = x.dueDate as string;
    items.push({ key: `plan:${x.id}`, date: due, dueDate: due, partNo: x.partNo === 2 ? 2 : 1, state: stateOf(due), paidAt: null });
  }

  const since = addDays(today, -paidDays);
  for (const x of mine) {
    if (x.status !== 'received' || !x.paidAt || x.paidAt < since || x.paidAt > today) continue;
    items.push({
      key: `plan:${x.id}`, date: x.dueDate || x.paidAt, dueDate: x.dueDate,
      partNo: x.partNo === 2 ? 2 : 1, state: 'paid', paidAt: x.paidAt,
    });
  }

  if (!expected.length) {
    const f = calendarDue(client, mine, today);
    if (f) items.push(f);
  }
  return items.sort(byUrgency);
}

/** Срок по дню договора для SMM-клиента без ожидаемых планов: неоплаченный
 *  прошедший срок, а если его нет — ближайший будущий. */
function calendarDue(client: FinClient, mine: FinPlan[], today: string): PayItem | null {
  if (client.direction !== 'smm') return null;
  const tariff = Number(client.tariff) || 0;
  const anchor = client.cycleAnchor || client.contractDate;
  const day = dayOf(anchor);
  if (tariff <= 0 || !anchor || day === null) return null;

  const received = (ym: string) => mine
    .filter(x => x.ym === ym && x.status === 'received')
    .reduce((s, x) => s + (Number(x.amount) || 0), 0);
  // Срок не позже последней полной оплаты уже покрыт ею; до начала договора
  // долгов нет.
  const open = (due: string) =>
    !(client.cycleAnchor && due <= client.cycleAnchor)
    && !(!client.cycleAnchor && client.contractDate && due < client.contractDate);

  const todayYm = ymOf(today);
  const cur = dueInMonth(todayYm, day);
  const past = cur <= today ? cur : dueInMonth(shiftYm(todayYm, -1), day);
  if (open(past) && received(ymOf(past)) <= 0) {
    return { key: `due:${client.id}:${past}`, date: past, dueDate: past, partNo: 1, state: past < today ? 'late' : 'today', paidAt: null };
  }
  const next = cur > today ? cur : dueInMonth(shiftYm(todayYm, 1), day);
  if (open(next) && received(ymOf(next)) < tariff - 0.005) {
    return { key: `due:${client.id}:${next}`, date: next, dueDate: next, partNo: 1, state: 'wait', paidAt: null };
  }
  return null;
}
