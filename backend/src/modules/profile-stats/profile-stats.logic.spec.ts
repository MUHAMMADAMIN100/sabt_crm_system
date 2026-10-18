import {
  AchievementInput, Delivery, achievementsOf, deliveryStreak, goalProgress, levelOf, pointsOf, storyStreak, streaks,
} from './profile-stats.logic';

// Личный профиль, вариант Б (решение владельца 17.10.2026): уровень, серии,
// очки, достижения и цели считаются из истории — проверяем правила.

const TODAY = '2026-10-17';

describe('levelOf — уровень по очкам', () => {
  it('как на макете: 1 240 очков — уровень 6, до седьмого 1 500', () => {
    expect(levelOf(1240)).toEqual({ level: 6, points: 1240, from: 1000, to: 1500 });
  });
  it('с нуля — первый уровень; ровно на пороге — уже следующий', () => {
    expect(levelOf(0).level).toBe(1);
    expect(levelOf(100).level).toBe(2);
    expect(levelOf(99).level).toBe(1);
  });
  it('после десятого уровня — каждые 1 000 очков', () => {
    expect(levelOf(3600)).toEqual({ level: 10, points: 3600, from: 3600, to: 4600 });
    expect(levelOf(5000).level).toBe(11);
  });
});

describe('streaks — серии', () => {
  it('текущая — хвост подряд, лучшая — самый длинный отрезок', () => {
    expect(streaks([true, true, true, false, true, true])).toEqual({ current: 2, best: 3 });
    expect(streaks([])).toEqual({ current: 0, best: 0 });
  });

  it('сторис: незакрытый сегодняшний день серию не рвёт, день без проектов — тоже', () => {
    const d = (day: string, projects: number, covered: number, mine: number) => ({ day, projects, covered, mine });
    const res = storyStreak([
      d('2026-10-14', 2, 2, 1),
      d('2026-10-15', 0, 0, 0),
      d('2026-10-16', 2, 2, 2),
      d(TODAY, 2, 1, 0),
    ], TODAY);
    expect(res).toEqual({ current: 2, best: 2, okDays: 2 });
  });

  it('сторис: пропущенный проект рвёт серию, даже если свои выложены', () => {
    const res = storyStreak([
      { day: '2026-10-15', projects: 2, covered: 2, mine: 1 },
      { day: '2026-10-16', projects: 2, covered: 1, mine: 1 },
    ], TODAY);
    expect(res.current).toBe(0);
  });

  it('в срок подряд — по порядку сроков', () => {
    const list: Delivery[] = [
      { due: '2026-10-10', onTime: true, kind: 'task' },
      { due: '2026-10-03', onTime: false, kind: 'content' },
      { due: '2026-10-05', onTime: true, kind: 'task' },
    ];
    expect(deliveryStreak(list)).toEqual({ current: 2, best: 2 });
  });
});

describe('pointsOf — очки', () => {
  it('сторис +10, публикация +15, задача +20, опоздание −10; ниже нуля не бывает', () => {
    expect(pointsOf({ storyOkDays: 10, contentOnTime: 2, tasksOnTime: 1, lateDays: 3 })).toBe(100 + 30 + 20 - 30);
    expect(pointsOf({ storyOkDays: 0, contentOnTime: 0, tasksOnTime: 0, lateDays: 5 })).toBe(0);
  });
});

describe('achievementsOf — достижения', () => {
  const base = (over: Partial<AchievementInput> = {}): AchievementInput => ({
    kind: 'smm', role: 'smm_specialist', tenureMonths: 19,
    shiftMonths: [{ ym: '2026-09', worked: 22, late: 0 }, { ym: '2026-10', worked: 11, late: 0 }],
    pastEff: [{ ym: '2026-07', percent: 70 }, { ym: '2026-08', percent: 75 }, { ym: '2026-09', percent: 79 }],
    nowEff: 86, deliveries: [], tasksOnTime: 0, contentOnTime: 64,
    storiesTotal: 1200, storyBest: 21, storyBestMonth: { ok: 30, days: 30 }, today: TODAY, ...over,
  });
  const byKey = (a: AchievementInput) => Object.fromEntries(achievementsOf(a).map(x => [x.key, x]));

  it('SMM: двенадцать достижений, открытые и закрытые с прогрессом', () => {
    const list = achievementsOf(base());
    expect(list).toHaveLength(12);
    const m = byKey(base());
    expect(m.no_late_month.unlocked).toBe(true);
    expect(m.year1.unlocked).toBe(true);
    expect(m.year2).toEqual(expect.objectContaining({ unlocked: false, progress: { value: 19, target: 24 } }));
    expect(m.best_month.unlocked).toBe(true);
    expect(m.stories_month.unlocked).toBe(true);
    expect(m.stories1000.unlocked).toBe(true);
    expect(m.stories_streak30.progress).toEqual({ value: 21, target: 30 });
    expect(m.content100.progress).toEqual({ value: 64, target: 100 });
  });

  it('«Лучший месяц» нужен хотя бы за три месяца оценки', () => {
    const m = byKey(base({ pastEff: [{ ym: '2026-09', percent: 90 }] }));
    expect(m.best_month.unlocked).toBe(false);
  });

  it('«Три месяца по норме» — подряд от 90 %, считая с последнего', () => {
    const m = byKey(base({ pastEff: [{ ym: '2026-07', percent: 95 }, { ym: '2026-08', percent: 80 }, { ym: '2026-09', percent: 92 }] }));
    expect(m.three_months.progress).toEqual({ value: 1, target: 3 });
  });

  it('производство: карточки по роли — «съёмок» у видеографа', () => {
    const titles = achievementsOf(base({ kind: 'production', role: 'videographer' })).map(a => a.title);
    expect(titles).toContain('100 съёмок в срок');
    expect(titles).not.toContain('1 000 сторис');
  });

  it('«Месяц без просрочек» — прошедший месяц, где 3+ сдачи и все вовремя', () => {
    const d = (due: string, onTime = true): Delivery => ({ due, onTime, kind: 'task' });
    expect(byKey(base({ kind: 'tasks', role: 'developer', deliveries: [d('2026-09-02'), d('2026-09-10'), d('2026-09-20')] })).no_overdue_month.unlocked).toBe(true);
    expect(byKey(base({ kind: 'tasks', role: 'developer', deliveries: [d('2026-09-02'), d('2026-09-10', false), d('2026-09-20')] })).no_overdue_month.unlocked).toBe(false);
    // текущий месяц ещё идёт — не считается
    expect(byKey(base({ kind: 'tasks', role: 'developer', deliveries: [d('2026-10-02'), d('2026-10-10'), d('2026-10-12')] })).no_overdue_month.unlocked).toBe(false);
  });
});

describe('goalProgress — цели месяца', () => {
  const metrics = { efficiency: 86, kpi: { content_on_time: 88 }, storyOkDays: 15, ontimeShifts: 11 };
  const g = (over: Record<string, unknown>) => ({ id: 'g', title: 'Цель', metric: null, target: null, done: false, ...over }) as any;

  it('отмечаемая сотрудником — выполнена по галочке', () => {
    expect(goalProgress(g({ done: true }), metrics)).toEqual(expect.objectContaining({ value: null, reached: true }));
  });
  it('измеримые CRM считает сама', () => {
    expect(goalProgress(g({ metric: 'stories_days', target: 30 }), metrics)).toEqual(expect.objectContaining({ value: 15, reached: false }));
    expect(goalProgress(g({ metric: 'kpi:content_on_time', target: 85 }), metrics)).toEqual(expect.objectContaining({ value: 88, reached: true }));
    expect(goalProgress(g({ metric: 'efficiency', target: 90 }), { ...metrics, efficiency: null })).toEqual(expect.objectContaining({ value: null, reached: false }));
  });
});
