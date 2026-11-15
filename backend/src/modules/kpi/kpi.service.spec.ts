import { KpiService } from './kpi.service';

/** «Один KPI» (15.11.2026, SALES_SPEC §6): у менеджера продаж /kpi/user —
 *  те же 5 метрик и тот же общий процент, что /clients/kpi. */

const salesKpi = (over: Record<string, any> = {}) => ({
  periodFrom: '', periodTo: '', overallPercent: 37, restDay: false, workDays: 10,
  items: [
    { key: 'funnel_progress', label: 'Продвижения по воронке', target: 200, value: 50, percent: 25, done: false },
    { key: 'new_companies', label: 'Новые компании в базе', target: 150, value: 60, percent: 40, done: false },
    { key: 'cold_calls', label: 'Звонки', target: 200, value: 100, percent: 50, done: false },
    { key: 'personal_emails', label: 'Персональные письма', target: 100, value: 30, percent: 30, done: false },
    { key: 'meetings', label: 'Встречи / созвоны', target: 20, value: 8, percent: 40, done: false },
  ],
  ...over,
});

function make(user: Record<string, any>, kpi: any = salesKpi()) {
  const svc: any = Object.create(KpiService.prototype);
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  const manager = { query: jest.fn(async () => []) };
  const repo = (extra: Record<string, any> = {}) => ({
    manager, find: jest.fn(async () => []), findOne: jest.fn(async () => null), ...extra,
  });
  svc.userRepo = repo({ find: jest.fn(async () => [user]) });
  for (const k of ['employeeRepo', 'taskRepo', 'sessionRepo', 'storyRepo', 'projectRepo', 'leadRepo', 'activityRepo']) svc[k] = repo();
  svc.clientsService = { kpi: jest.fn(async () => kpi) };
  // any: clientsService у сервиса приватный, а тесту нужен его мок.
  return svc;
}

describe('KpiService — KPI менеджера продаж', () => {
  it('основная роль МП: только 5 метрик продаж и общий процент из /clients/kpi', async () => {
    const svc = make({ id: 'u1', role: 'sales_manager_dev', secondaryRole: null });
    const k = await svc.computeUserKpi('u1', '2026-11-01', '2026-11-30');
    expect(svc.clientsService.kpi).toHaveBeenCalledWith('u1', 'development', '2026-11-01', '2026-11-30');
    expect(k!.items.map(i => i.key)).toEqual([
      'sales_funnel_progress', 'sales_new_companies', 'sales_cold_calls', 'sales_personal_emails', 'sales_meetings',
    ]);
    expect(k!.overallPercent).toBe(37);
    expect(k!.noData).toBe(false);
  });

  it('МП второй ролью тоже считается менеджером продаж (направление — по второй роли)', async () => {
    const svc = make({ id: 'u2', role: 'smm_specialist', secondaryRole: 'sales_manager_smm' });
    const k = await svc.computeUserKpi('u2', '2026-11-01', '2026-11-30');
    expect(svc.clientsService.kpi).toHaveBeenCalledWith('u2', 'smm', '2026-11-01', '2026-11-30');
    expect(k!.items).toHaveLength(5);
    expect(k!.items.some(i => i.key === 'content_on_time' || i.key === 'deadline_rate')).toBe(false);
    expect(k!.overallPercent).toBe(37);
  });

  it('выходной (нет рабочих дней) — оценки нет, как в /clients/kpi', async () => {
    const svc = make({ id: 'u1', role: 'sales_manager_smm' }, salesKpi({ restDay: true, workDays: 0, overallPercent: 0 }));
    const k = await svc.computeUserKpi('u1', '2026-11-15', '2026-11-15');
    expect(k!.items).toEqual([]);
    expect(k!.noData).toBe(true);
    expect(k!.overallPercent).toBe(0);
  });

  it('не МП — KPI продаж не спрашиваем', async () => {
    const svc = make({ id: 'd', role: 'developer', secondaryRole: null });
    await svc.computeUserKpi('d', '2026-11-01', '2026-11-30');
    expect(svc.clientsService.kpi).not.toHaveBeenCalled();
  });
});
