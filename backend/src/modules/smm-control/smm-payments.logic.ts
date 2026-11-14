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
  /** Дата операции, которой платёж получен (finance_transactions.date).
   *  Операция отменена или удалена — null. */
  paidAt: string | null;
  /** Операция, которой платёж получен, — чтобы не показать её второй раз. */
  receivedTxId?: string | null;
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

/** Название без регистра, «ё», знаков и порядка слов — чтобы связать SMM-проект
 *  с клиентом в Финансах: «Доктор Манижа» и «Манижа Доктор» — один клиент. */
export const nameKey = (s?: string | null) => String(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/gi, ' ').trim().split(' ').filter(Boolean).sort().join(' ');

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
 *  2) иначе совпадение названия — только однозначное и только с клиентом
 *     SMM (14.11.2026: CRM «Alif» подхватывал клиента разработки «Alif», и
 *     его деньги считались и менеджеру SMM, и менеджеру разработки). Два
 *     клиента с одним названием не связываем — лучше «срок не найден», чем
 *     чужая оплата. Живой клиент важнее архивного; архивный — только когда
 *     живого с таким названием нет: его прошлые оплаты не должны пропадать.
 */
export function resolveFinanceLinks<C extends { id: string; name: string; archived?: boolean; direction?: string | null }>(
  projects: Array<{ id: string; name: string; financeProjectId?: string | null }>,
  clients: C[],
): Map<string, { client: C; by: 'manual' | 'name' }> {
  const byId = new Map(clients.map(c => [c.id, c]));
  const smm = clients.filter(c => c.direction === 'smm');
  const unique = (list: C[]) => {
    const count = new Map<string, number>();
    for (const c of list) { const k = nameKey(c.name); count.set(k, (count.get(k) || 0) + 1); }
    const out = new Map<string, C>();
    for (const c of list) { const k = nameKey(c.name); if (k && count.get(k) === 1) out.set(k, c); }
    return out;
  };
  const live = smm.filter(c => !c.archived);
  const liveKeys = new Set(live.map(c => nameKey(c.name)));
  const byName = unique(live);
  const byOldName = unique(smm.filter(c => c.archived));

  const out = new Map<string, { client: C; by: 'manual' | 'name' }>();
  for (const p of projects) {
    const manual = typeof p.financeProjectId === 'string' ? byId.get(p.financeProjectId) : undefined;
    if (manual) { out.set(p.id, { client: manual, by: 'manual' }); continue; }
    const k = nameKey(p.name);
    const named = byName.get(k) || (liveKeys.has(k) ? undefined : byOldName.get(k));
    if (named) out.set(p.id, { client: named, by: 'name' });
  }
  return out;
}

/** Запись истории ответственного менеджера: с этого дня (включительно)
 *  клиент за ним; null — менеджера сняли. */
export interface ManagerSpan { managerId: string | null; from: string }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** История из базы (jsonb) — только корректные записи, по порядку дат;
 *  при равных датах — в порядке записи. */
export function cleanHistory(raw: unknown): ManagerSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h: any, i) => ({
      i,
      span: h && typeof h === 'object' && typeof h.from === 'string' && ISO_DAY.test(h.from.slice(0, 10))
        ? { managerId: typeof h.managerId === 'string' && h.managerId ? h.managerId : null, from: h.from.slice(0, 10) }
        : null,
    }))
    .filter((x): x is { i: number; span: ManagerSpan } => !!x.span)
    .sort((a, b) => a.span.from.localeCompare(b.span.from) || a.i - b.i)
    .map(x => x.span);
}

/** Кто отвечал за клиента в день date (решение владельца 14.11.2026:
 *  оплата засчитывается менеджеру, который был ответственным в день
 *  оплаты). Без истории — текущий менеджер, как раньше. До первой записи —
 *  менеджер первой записи: при прежнем правиле эти деньги и так были его. */
export function managerOn(history: ManagerSpan[], current: string | null, date: string): string | null {
  if (!history.length) return current;
  let who = history[0].managerId;
  for (const h of history) {
    if (h.from > date) break;
    who = h.managerId;
  }
  return who;
}

/** История после смены менеджера. При первой смене прежний менеджер
 *  записывается первым (since — с какого дня он вёл клиента), иначе его
 *  прошлые оплаты ушли бы новому. Тот же менеджер — история не меняется. */
export function withManagerChange(
  raw: unknown, prev: string | null, next: string | null, day: string, since?: string | null,
): ManagerSpan[] {
  const list = cleanHistory(raw);
  if ((prev || null) === (next || null)) return list;
  if (!list.length && prev) list.push({ managerId: prev, from: since && ISO_DAY.test(since) && since < day ? since : day });
  list.push({ managerId: next || null, from: day });
  return list;
}

/** Чей клиент: кто ведёт его сейчас, кто вёл раньше и живой ли он. */
export interface ClientOwner {
  current: string | null;
  history: ManagerSpan[];
  /** Проект CRM в архиве — у клиента остаются только прошлые оплаты. */
  live: boolean;
}

/** Мог ли клиент приносить деньги менеджерам, подходящим под want. */
export const mayOwn = (o: ClientOwner, want: (managerId: string | null) => boolean) =>
  want(o.current) || o.history.some(h => want(h.managerId));

/** Оплаты клиента, которые относятся к менеджерам под want: полученная —
 *  тому, кто отвечал за клиента в день оплаты; ожидаемая, просроченная и
 *  прогноз — только текущему ответственному и только у живого клиента. */
export function ownedPays<T extends { state: PayState; date: string }>(
  items: T[], owner: ClientOwner, want: (managerId: string | null) => boolean,
): T[] {
  return items.filter(it => (it.state === 'paid'
    ? want(managerOn(owner.history, owner.current, it.date))
    : owner.live && want(owner.current)));
}

/** SMM-проект CRM — для выбора, чей клиент «Финансов». */
export interface OwnerProject {
  id: string;
  name: string;
  financeProjectId?: string | null;
  live: boolean;
  managerId: string | null;
  history?: unknown;
}

/** Клиент «Финансов» с его менеджером (у не-SMM он хранится у клиента). */
type OwnedClient = { id: string; name: string; archived?: boolean; direction?: string | null; salesManagerId?: string | null; salesManagerHistory?: unknown };

/**
 * Деньги каких клиентов чьи. Клиента SMM ведёт менеджер связанного проекта
 * CRM; если проектов несколько — выбранный вручную важнее найденного по
 * названию, живой важнее архивного. Клиент SMM без проекта CRM ничей.
 * Остальных (разработка, дизайн, обслуживание) ведёт менеджер, назначенный
 * в «Доходе», — если клиента не связали с SMM-проектом вручную.
 */
export function payScope<C extends OwnedClient>(projects: OwnerProject[], clients: C[]) {
  const links = resolveFinanceLinks(projects, clients);
  const rank = (p: OwnerProject, by: 'manual' | 'name') => (by === 'manual' ? 0 : 2) + (p.live ? 0 : 1);
  const best = new Map<string, { project: OwnerProject; by: 'manual' | 'name' }>();
  for (const p of [...projects].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id))) {
    const l = links.get(p.id);
    if (!l) continue;
    const cur = best.get(l.client.id);
    if (!cur || rank(p, l.by) < rank(cur.project, cur.by)) best.set(l.client.id, { project: p, by: l.by });
  }
  const out = new Map<string, { client: C; name: string; projectId: string | null; owner: ClientOwner }>();
  for (const c of clients) {
    const hit = best.get(c.id);
    if (hit) {
      out.set(c.id, {
        client: c, name: hit.project.name, projectId: hit.project.id,
        owner: { current: hit.project.managerId, history: cleanHistory(hit.project.history), live: hit.project.live },
      });
    } else if (c.direction !== 'smm') {
      out.set(c.id, {
        client: c, name: c.name, projectId: null,
        owner: { current: c.salesManagerId || null, history: cleanHistory(c.salesManagerHistory), live: true },
      });
    }
  }
  return out;
}

const ORDER: Record<PayState, number> = { late: 0, today: 1, wait: 2, paid: 3 };
type Urgent = { key: string; date: string; state: PayState };
/** Сначала просроченные (самые давние), потом сегодня, ближайшие и в конце
 *  оплаченные (свежие первыми). */
export const byUrgency = (a: Urgent, b: Urgent) =>
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

/** Поступление по проекту из журнала «Финансов» (finance_transactions). */
export interface FinTx {
  id: string;
  projectId: string;
  date: string;
  amount: number;
  /** Без привязки к зарплате, подписке и долгу — как источник 4 «Планирования». */
  plain: boolean;
}

/** Оплата клиента в календаре менеджера (решение владельца 17.10.2026):
 *  то же, что владелец видит в «Финансах → Планирование», — день, сумма,
 *  состояние. */
export interface CalPay {
  key: string;
  clientId: string;
  date: string;
  /** Месяц, за который оплата: у плана — его месяц, у поступления — месяц даты. */
  ym: string;
  amount: number;
  partNo: number;
  state: PayState;
  /** plan — плановая оплата, tx — поступление без плана, forecast — прогноз по тарифу. */
  source: 'plan' | 'tx' | 'forecast';
}

/** День в месяце по дню договора; без договора — первое число. */
const contractDay = (client: FinClient, ym: string) => {
  const d = dayOf(client.contractDate);
  return d ? dueInMonth(ym, d) : `${ym}-01`;
};
const monthsBetween = (fromYm: string, toYm: string) => {
  const out: string[] = [];
  for (let ym = fromYm; ym <= toYm && out.length < 36; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
};

/**
 * Деньги одного клиента в календаре менеджера за [from, to] — по правилам
 * календаря «Планирования» (FinancePlanningPage, calTxns):
 *  1) плановые оплаты: полученная — в день прихода денег, ожидаемая — в срок,
 *     без срока — в день договора своего месяца; ожидаемые у клиента на паузе
 *     не показываем;
 *  2) поступления по проекту без плана — в свой день;
 *  3) прогноз SMM/обслуживания на день договора по тарифу — для текущего и
 *     будущих месяцев, где нет ни плана, ни поступления, в пределах срока
 *     удержания (без срока — 12 месяцев);
 *  4) неоплаченный срок SMM из прошлого месяца — как строка SMM в
 *     «Просрочено» (buildLateOther): у клиента без ожидаемых планов срок по
 *     дню последней полной оплаты (paymentItems), сумма — тариф.
 * Просроченные возвращаются и вне окна — для блока «Просрочено». Это и
 * есть единое правило сроков: карточка проекта, «Календарь», «Контроль» и
 * «Панель» берут оплаты отсюда (14.11.2026).
 */
export function calendarPays(
  client: FinClient & { retentionMonths?: number | null },
  plans: FinPlan[], txs: FinTx[], from: string, to: string, today: string,
): CalPay[] {
  const mine = plans.filter(x => x.projectId === client.id);
  const myTx = txs.filter(t => t.projectId === client.id);
  const earning = isEarning(client);
  const inWindow = (d: string) => d >= from && d <= to;
  const stateOf = (d: string): PayState => (d < today ? 'late' : d === today ? 'today' : 'wait');
  const planYm = (x: FinPlan) => (x.dueDate ? ymOf(x.dueDate) : x.ym);
  const out: CalPay[] = [];

  const linked = new Set(mine.map(x => x.receivedTxId).filter(Boolean) as string[]);
  for (const x of mine) {
    const partNo = x.partNo === 2 ? 2 : 1;
    const amount = Number(x.amount) || 0;
    if (x.status === 'received') {
      // Операция оплаты отменена или удалена — денег нет (как в «Планировании»).
      if (x.receivedTxId && !x.paidAt) continue;
      const date = x.paidAt || x.dueDate || contractDay(client, x.ym);
      if (inWindow(date)) out.push({ key: `plan:${x.id}`, clientId: client.id, date, ym: x.ym, amount, partNo, state: 'paid', source: 'plan' });
      continue;
    }
    if (x.status !== 'expected' || !earning) continue;
    const date = x.dueDate || contractDay(client, x.ym);
    const state = stateOf(date);
    if (inWindow(date) || state === 'late') out.push({ key: `plan:${x.id}`, clientId: client.id, date, ym: x.ym, amount, partNo, state, source: 'plan' });
  }

  for (const t of myTx) {
    if (!t.plain || linked.has(t.id) || !inWindow(t.date)) continue;
    const past = t.date <= today;
    if (!past && !earning) continue;
    out.push({ key: `tx:${t.id}`, clientId: client.id, date: t.date, ym: ymOf(t.date), amount: Number(t.amount) || 0, partNo: 1, state: past ? 'paid' : stateOf(t.date), source: 'tx' });
  }

  const tariff = Number(client.tariff) || 0;
  if (earning && tariff > 0 && (client.direction === 'smm' || client.direction === 'maintenance')) {
    const curYm = ymOf(today);
    const startYm = client.contractDate ? ymOf(client.contractDate) : curYm;
    const horizon = shiftYm(curYm, client.retentionMonths != null ? Number(client.retentionMonths) : 12);
    const covered = new Set<string>([...mine.map(planYm), ...myTx.map(t => ymOf(t.date))]);
    // Текущий месяц считаем всегда: его прошедший срок — это «Просрочено».
    const months = new Set([curYm, ...monthsBetween(ymOf(from), ymOf(to))]);
    for (const ym of [...months].sort()) {
      if (ym < curYm || ym < startYm || ym > horizon || covered.has(ym)) continue;
      const date = contractDay(client, ym);
      const state = stateOf(date);
      if (inWindow(date) || state === 'late') out.push({ key: `fc:${client.id}:${ym}`, clientId: client.id, date, ym, amount: tariff, partNo: 1, state, source: 'forecast' });
    }
  }

  // Не заплатил в прошлом месяце — долг остаётся в «Просрочено» и 1-го
  // числа не пропадает. Правило строки SMM «Планирования»: срок не из плана,
  // ожидаемых планов до текущего месяца нет, срок прошёл и он не в текущем
  // месяце (текущий месяц покрывает прогноз выше).
  if (earning && tariff > 0 && client.direction === 'smm') {
    const curYm = ymOf(today);
    const due = paymentItems(client, mine, today).find(it => it.state !== 'paid');
    const open = mine.some(x => x.status === 'expected' && x.ym <= curYm);
    if (due && !due.key.startsWith('plan:') && !open && due.date < today && ymOf(due.date) !== curYm) {
      out.push({ key: `due:${client.id}:${due.date}`, clientId: client.id, date: due.date, ym: ymOf(due.date), amount: tariff, partNo: 1, state: 'late', source: 'forecast' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.partNo - b.partNo || a.key.localeCompare(b.key));
}

/** Оплата клиента в карточке проекта и в «Календаре»: день и состояние без
 *  суммы. У полученной paidAt — день прихода денег. */
export function toPayItem(it: CalPay): PayItem {
  const paid = it.state === 'paid';
  return { key: it.key, date: it.date, dueDate: paid ? null : it.date, partNo: it.partNo, state: it.state, paidAt: paid ? it.date : null };
}

/** Строка «Оплата клиента» в карточке проекта: ближайшее неоплаченное
 *  (просроченное — первым) и последняя оплата за PAID_VISIBLE_DAYS дней. */
export function cardPays(items: CalPay[], today: string, paidDays = PAID_VISIBLE_DAYS) {
  const since = addDays(today, -paidDays);
  const next = items.filter(it => it.state !== 'paid').sort(byUrgency)[0] || null;
  const lastPaid = items
    .filter(it => it.state === 'paid' && it.date >= since && it.date <= today)
    .sort(byUrgency)[0] || null;
  return { next, lastPaid };
}

/** Колонка «Оплата» в «Контроле» за месяц [from, to] — по тем же оплатам:
 *  late — есть неоплаченное с прошедшим сроком (и из прошлых месяцев),
 *  wait — ждём оплату месяца, paid — оплата месяца получена, null — нечего
 *  показать. */
export function monthPayState(items: CalPay[], from: string, to: string): 'late' | 'wait' | 'paid' | null {
  if (items.some(it => it.state === 'late' && it.date <= to)) return 'late';
  if (items.some(it => it.state !== 'paid' && it.date >= from && it.date <= to)) return 'wait';
  if (items.some(it => it.state === 'paid' && it.date >= from && it.date <= to)) return 'paid';
  return null;
}
