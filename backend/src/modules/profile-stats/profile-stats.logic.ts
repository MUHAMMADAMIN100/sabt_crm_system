/**
 * Личный профиль сотрудника (вариант Б, решение владельца 17.10.2026):
 * эффективность, серии, очки и уровень, достижения, цели месяца, бонус.
 * Здесь — чистые правила без базы, чтобы их можно было проверить тестами.
 */

/** Очки (владелец утвердил 17.10.2026). */
export const POINTS = {
  /** День, когда сторис по всем своим проектам выложены. */
  storyDay: 10,
  /** Публикация или карточка производства сдана в срок. */
  contentOnTime: 15,
  /** Задача сдана в срок. */
  taskOnTime: 20,
  /** Опоздание на смену. */
  late: -10,
} as const;

/** Бонус за эффективность. Правила владелец задаст позже (17.10.2026: «пока
 *  оставь какой-нибудь стандартный») — сейчас только показываем, в зарплату
 *  сам он не попадает. */
export const BONUS_RULE = { threshold: 90, amount: 300 } as const;

/** Порог очков для уровня N — LEVELS[N-1]; после десятого — каждые 1 000. */
const LEVELS = [0, 100, 250, 450, 700, 1000, 1500, 2100, 2800, 3600];
const thresholdOf = (level: number) =>
  level <= LEVELS.length ? LEVELS[level - 1] : LEVELS[LEVELS.length - 1] + (level - LEVELS.length) * 1000;

export interface Level { level: number; points: number; from: number; to: number }

/** Уровень по очкам за всё время: «Уровень 6 · 1 240 / 1 500». */
export function levelOf(pointsRaw: number): Level {
  const points = Math.max(0, Math.round(pointsRaw));
  let level = 1;
  while (thresholdOf(level + 1) <= points) level += 1;
  return { level, points, from: thresholdOf(level), to: thresholdOf(level + 1) };
}

/** Серия: сколько подряд в конце (текущая) и лучшая за всё время. */
export function streaks(seq: boolean[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const ok of seq) {
    run = ok ? run + 1 : 0;
    if (run > best) best = run;
  }
  return { current: run, best };
}

/** День сторис: сколько своих проектов ждали сторис, сколько получили и
 *  сколько из них закрыл сам сотрудник. */
export interface StoryDay { day: string; projects: number; covered: number; mine: number }

/** День засчитан, если все проекты получили сторис и сотрудник выложил хотя
 *  бы одну сам. День без своих проектов — нейтральный, серию не рвёт. */
export const storyDayOk = (d: StoryDay) => d.projects > 0 && d.covered >= d.projects && d.mine > 0;

/**
 * Серия сторис. Сегодняшний день ещё идёт: если он пока не закрыт, серию не
 * рвём — считаем по вчера.
 */
export function storyStreak(days: StoryDay[], today: string): { current: number; best: number; okDays: number } {
  const seq = days
    .filter(d => d.projects > 0 && !(d.day === today && !storyDayOk(d)))
    .map(storyDayOk);
  return { ...streaks(seq), okDays: days.filter(storyDayOk).length };
}

/** Сдача в срок: задача или карточка с её сроком. */
export interface Delivery { due: string; onTime: boolean; kind: 'task' | 'content' }

/** «В срок подряд»: по порядку сроков; просроченная несданная тоже рвёт. */
export function deliveryStreak(list: Delivery[]): { current: number; best: number } {
  const seq = [...list].sort((a, b) => a.due.localeCompare(b.due)).map(d => d.onTime);
  return streaks(seq);
}

/** Смены: рабочий день и было ли опоздание — в порядке дат. */
export interface ShiftDay { day: string; late: boolean }

export interface PointsInput {
  storyOkDays: number;
  contentOnTime: number;
  tasksOnTime: number;
  lateDays: number;
}
export function pointsOf(p: PointsInput): number {
  return Math.max(0,
    p.storyOkDays * POINTS.storyDay
    + p.contentOnTime * POINTS.contentOnTime
    + p.tasksOnTime * POINTS.taskOnTime
    + p.lateDays * POINTS.late);
}

/** Эффективность месяца: null — оценки нет (отпуск, новичок, роль без KPI). */
export interface MonthEff { ym: string; percent: number | null }

export interface Achievement {
  key: string;
  title: string;
  unlocked: boolean;
  /** У закрытого — сколько уже есть и сколько нужно. */
  progress?: { value: number; target: number };
}

/** Направление работы — от него зависят серия и часть достижений. */
export type WorkKind = 'smm' | 'production' | 'tasks';

/** Карточки производства по роли: что именно сдаёт человек. */
export const PRODUCTION_UNIT: Record<string, { many: string; label: string }> = {
  videographer: { many: 'съёмок', label: 'Съёмки в срок' },
  video_editor: { many: 'монтажей', label: 'Монтаж в срок' },
  designer: { many: 'макетов', label: 'Макеты в срок' },
};

export interface AchievementInput {
  kind: WorkKind;
  role: string;
  /** Полных месяцев в компании. */
  tenureMonths: number;
  /** Прошедшие месяцы по сменам: рабочих дней и опозданий. */
  shiftMonths: Array<{ ym: string; worked: number; late: number }>;
  /** Эффективность прошедших месяцев, старые первыми. */
  pastEff: MonthEff[];
  /** Эффективность текущего месяца. */
  nowEff: number | null;
  deliveries: Delivery[];
  /** Сдачи в срок за всё время: задачи и карточки. */
  tasksOnTime: number;
  contentOnTime: number;
  /** SMM: сторис за всё время, лучшая серия и лучший полный месяц сторис. */
  storiesTotal?: number;
  storyBest?: number;
  storyBestMonth?: { ok: number; days: number };
  today: string;
}

const ymOf = (iso: string) => iso.slice(0, 7);
const prog = (value: number, target: number) => ({ value: Math.min(value, target), target });

/** Достижения: восемь общих и три–четыре по направлению работы. Считаются
 *  заново по истории — хранить «открыто» не нужно. */
export function achievementsOf(a: AchievementInput): Achievement[] {
  const list: Achievement[] = [];
  const add = (key: string, title: string, value: number, target: number) =>
    list.push(value >= target ? { key, title, unlocked: true } : { key, title, unlocked: false, progress: prog(value, target) });

  // Месяц без опозданий: прошедший месяц, где отработано хотя бы 10 смен.
  const cleanMonth = a.shiftMonths.some(m => m.worked >= 10 && m.late === 0);
  const curMonth = a.shiftMonths.find(m => m.ym === ymOf(a.today));
  list.push(cleanMonth ? { key: 'no_late_month', title: 'Без опозданий', unlocked: true }
    : { key: 'no_late_month', title: 'Без опозданий', unlocked: false, progress: prog(curMonth && !curMonth.late ? curMonth.worked : 0, 10) });

  add('year1', 'Год в WeBrand', a.tenureMonths, 12);
  add('year2', 'Два года в WeBrand', a.tenureMonths, 24);

  // Лучший месяц: прошлый месяц — лучший за полгода (нужно хотя бы 3 месяца оценки).
  const rated = a.pastEff.filter(m => m.percent !== null) as Array<{ ym: string; percent: number }>;
  const last = rated[rated.length - 1];
  const bestMonth = rated.length >= 3 && !!last && last.percent >= Math.max(...rated.map(m => m.percent)) && last.percent > 0;
  list.push(bestMonth ? { key: 'best_month', title: 'Лучший месяц', unlocked: true }
    : { key: 'best_month', title: 'Лучший месяц', unlocked: false, progress: prog(Math.min(rated.length, 3), 3) });

  const bestEff = Math.max(0, ...rated.map(m => m.percent), a.nowEff ?? 0);
  add('eff95', 'Эффективность 95 %', bestEff, 95);

  // Три месяца подряд с эффективностью от 90 % — по последним прошедшим.
  let run = 0;
  for (const m of [...a.pastEff].reverse()) { if (m.percent !== null && m.percent >= 90) run += 1; else break; }
  add('three_months', 'Три месяца по норме', run, 3);

  const ds = deliveryStreak(a.deliveries);
  add('ontime10', '10 в срок подряд', ds.best, 10);

  // Месяц без просрочек: прошедший месяц, где всё со сроком сдано вовремя.
  const byMonth = new Map<string, { all: number; ok: number }>();
  for (const d of a.deliveries) {
    const ym = ymOf(d.due);
    if (ym >= ymOf(a.today)) continue;
    const m = byMonth.get(ym) || { all: 0, ok: 0 };
    m.all += 1; if (d.onTime) m.ok += 1;
    byMonth.set(ym, m);
  }
  const cleanDelivery = [...byMonth.values()].some(m => m.all >= 3 && m.ok === m.all);
  list.push(cleanDelivery ? { key: 'no_overdue_month', title: 'Месяц без просрочек', unlocked: true }
    : { key: 'no_overdue_month', title: 'Месяц без просрочек', unlocked: false });

  if (a.kind === 'smm') {
    const bm = a.storyBestMonth || { ok: 0, days: 30 };
    list.push(bm.days > 0 && bm.ok >= bm.days ? { key: 'stories_month', title: 'Сторис 30 из 30', unlocked: true }
      : { key: 'stories_month', title: 'Сторис 30 из 30', unlocked: false, progress: prog(bm.ok, bm.days || 30) });
    add('stories_streak30', 'Серия 30 дней', a.storyBest || 0, 30);
    add('stories1000', '1 000 сторис', a.storiesTotal || 0, 1000);
    add('content100', '100 публикаций в срок', a.contentOnTime, 100);
  } else if (a.kind === 'production') {
    const unit = PRODUCTION_UNIT[a.role]?.many || 'карточек';
    add('ontime30', '30 в срок подряд', ds.best, 30);
    add('content50', `50 ${unit} в срок`, a.contentOnTime, 50);
    add('content100', `100 ${unit} в срок`, a.contentOnTime, 100);
  } else {
    add('ontime30', '30 в срок подряд', ds.best, 30);
    add('tasks50', '50 задач в срок', a.tasksOnTime, 50);
    add('tasks100', '100 задач в срок', a.tasksOnTime, 100);
  }
  return list;
}

/** Цель месяца. metric = null — сотрудник отмечает сам; иначе CRM считает. */
export interface GoalRow {
  id: string;
  title: string;
  metric: string | null;
  target: number | null;
  done: boolean;
}

/** Что можно поставить измеримой целью. */
export const GOAL_METRICS: Record<string, { label: string; unit: '%' | 'days' | 'shifts' }> = {
  efficiency: { label: 'Эффективность', unit: '%' },
  stories_days: { label: 'Сторис без пропусков', unit: 'days' },
  ontime_shifts: { label: 'Смены без опозданий', unit: 'shifts' },
};

export interface GoalMetrics {
  efficiency: number | null;
  /** Проценты метрик KPI по ключу (Публикации в срок и т.д.). */
  kpi: Record<string, number>;
  storyOkDays: number;
  ontimeShifts: number;
}

/** Прогресс цели: измеримая выполнена сама, когда дошла до цели. */
export function goalProgress(g: GoalRow, m: GoalMetrics): GoalRow & { value: number | null; reached: boolean } {
  if (!g.metric) return { ...g, value: null, reached: g.done };
  const target = Number(g.target) || 0;
  let value: number | null = null;
  if (g.metric === 'efficiency') value = m.efficiency;
  else if (g.metric === 'stories_days') value = m.storyOkDays;
  else if (g.metric === 'ontime_shifts') value = m.ontimeShifts;
  else if (g.metric.startsWith('kpi:')) value = m.kpi[g.metric.slice(4)] ?? null;
  const reached = value !== null && target > 0 && value >= target;
  return { ...g, value, reached };
}
