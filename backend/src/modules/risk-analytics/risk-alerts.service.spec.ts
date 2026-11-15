import { RiskAlertsService } from './risk-alerts.service';
import { RiskAnalyticsService, dushanbeMonthRange, monthlyLimitsOf } from './risk-analytics.service';
import { NotificationType } from '../notifications/notification.entity';

/** Риск-алерты: менеджеры продаж не получают шум по старым данным. */

const USERS = [
  { id: 'D1', name: 'Дизайнер', role: 'designer', secondaryRole: null },
  { id: 'S1', name: 'МП СММ', role: 'sales_manager_smm', secondaryRole: null },
  { id: 'S2', name: 'Вторая роль', role: 'designer', secondaryRole: 'sales_manager_dev' },
  { id: 'F1', name: 'Основатель', role: 'founder', secondaryRole: null },
];
const ADMINS = [{ id: 'A1', name: 'Админ', role: 'admin', secondaryRole: null }];

/** activity — ответ запроса активности по контент-плану/сменам (15.11.2026):
 *  массив строк или 'fail' (запрос упал). */
function setup(activity: Array<{ userId: string }> | 'fail' = []) {
  const taskQb: any = {};
  for (const m of ['select', 'where', 'andWhere']) taskQb[m] = jest.fn(() => taskQb);
  taskQb.getRawMany = jest.fn(async () => []);

  // Если бы старые чекеры оплат вернулись в runAll, им было бы что слать:
  // проект со сроком оплаты завтра и платёж двухнедельной давности.
  const projectQb: any = {};
  for (const m of ['where', 'andWhere']) projectQb[m] = jest.fn(() => projectQb);
  projectQb.getMany = jest.fn(async () => [{
    id: 'P1', name: 'Сафо', managerId: null, salesManagerId: 'S1',
    nextPaymentDate: new Date(Date.now() + 86400000), paymentStatus: 'pending',
  }]);
  const projectRepo = {
    find: jest.fn(async () => []),
    createQueryBuilder: jest.fn(() => projectQb),
    manager: { query: jest.fn(async (sql: string) => (sql.includes('project_payments')
      ? [{ id: 'PP1', projectId: 'P1', amount: '1000', name: 'Сафо', salesManagerId: 'S1', projectType: 'SMM' }]
      : [])) },
  };
  const userRepo = {
    // where-массив — getTopAdmins, иначе — все активные.
    find: jest.fn(async (q: any) => (Array.isArray(q?.where) ? ADMINS : [...USERS, ...ADMINS])),
    manager: { query: jest.fn(async (sql: string) => {
      if (sql.includes('work_shifts')) {
        if (activity === 'fail') throw new Error('boom');
        return activity;
      }
      if (sql.includes('FROM employees')) return [{ id: 'E1', userId: 'D1' }];
      return [];
    }) },
  };
  const taskRepo = { createQueryBuilder: jest.fn(() => taskQb) };
  const notifications = { createIfNotRecent: jest.fn(async () => true) };
  const riskAnalytics = { getPmWorkload: jest.fn(async () => []), getEmployeeWorkload: jest.fn(async () => []) };
  const s = new RiskAlertsService(
    projectRepo as any, taskRepo as any, {} as any, userRepo as any, notifications as any, riskAnalytics as any, {} as any,
  );
  return { s, notifications, taskQb, userRepo };
}

describe('RiskAlertsService', () => {
  it('«Неактивен 2 дня»: менеджеры продаж (роль или вторая роль) исключены, ссылка — на id сотрудника', async () => {
    const { s, notifications, taskQb } = setup();
    await s.checkInactiveEmployees();

    const sent = notifications.createIfNotRecent.mock.calls.map((c: any[]) => c[0]);
    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent.map((n: any) => n.data.userId))).toEqual(new Set(['D1']));
    expect(new Set(sent.map((n: any) => n.userId))).toEqual(new Set(['A1', 'D1']));
    for (const n of sent) expect(n.link).toBe('/employees/E1');
    // МП не попадают даже в выборку активности.
    const ids = taskQb.where.mock.calls[0][1].ids;
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('S2');
  });

  it('«Неактивен 2 дня»: работа в контент-плане или смена — это активность (15.11.2026)', async () => {
    const { s, notifications, userRepo } = setup([{ userId: 'D1' }]);
    await s.checkInactiveEmployees();
    expect(notifications.createIfNotRecent).not.toHaveBeenCalled();
    // Запрос активности смотрит и контент-план, и смены.
    const sql = userRepo.manager.query.mock.calls.map((c: any[]) => c[0]).find((q: string) => q.includes('work_shifts'));
    expect(sql).toContain('content_plan_items');
  });

  it('«Неактивен 2 дня»: не прочитали контент-план/смены — молчим, а не шлём ложные алерты', async () => {
    const { s, notifications } = setup('fail');
    await s.checkInactiveEmployees();
    expect(notifications.createIfNotRecent).not.toHaveBeenCalled();
  });

  it('runAll: оплат по старым полям нет — никому, и менеджерам продаж ничего', async () => {
    const { s, notifications } = setup();
    await s.runAll();
    const sent = notifications.createIfNotRecent.mock.calls.map((c: any[]) => c[0]);
    expect(sent.filter((n: any) => [NotificationType.PAYMENT_OVERDUE_SOON, NotificationType.PAYMENT_REMINDER].includes(n.type))).toEqual([]);
    expect(sent.filter((n: any) => ['S1', 'S2'].includes(n.userId))).toEqual([]);
  });

  it('runAll: проверки «много задач на проверке» больше нет — таких статусов нет (15.11.2026)', async () => {
    const { s, notifications } = setup();
    await s.runAll();
    expect((s as any).checkTooManyPmReviews).toBeUndefined();
    const sent = notifications.createIfNotRecent.mock.calls.map((c: any[]) => c[0]);
    expect(sent.filter((n: any) => n.type === NotificationType.TOO_MANY_PM_REVIEWS)).toEqual([]);
  });
});

describe('Лимиты тарифа — помесячно (15.11.2026)', () => {
  it('месяц по Душанбе: 30.11 20:00 UTC — уже декабрь, конец — 1 января +05:00', () => {
    const r = dushanbeMonthRange(new Date('2026-11-30T20:00:00Z'));
    expect(r.from.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-12-31T19:00:00.000Z');
  });

  it('индивидуальный тариф берёт лимиты проекта; нулевой лимит — не лимит', () => {
    const custom = { isCustom: true, storiesPerMonth: 0, reelsPerMonth: 0, postsPerMonth: 0, designsPerMonth: 5 } as any;
    expect(monthlyLimitsOf(custom, { storiesPerMonth: 20, postsPerMonth: 0 })).toEqual({ story: 20 });
    const regular = { isCustom: false, storiesPerMonth: 30, reelsPerMonth: 4, postsPerMonth: 0, designsPerMonth: 2 } as any;
    expect(monthlyLimitsOf(regular, null)).toEqual({ story: 30, reel: 4, design: 2 });
    expect(monthlyLimitsOf(null, null)).toEqual({});
  });

  function planFactService(row: Record<string, string>) {
    const qb: any = {};
    for (const m of ['select', 'addSelect', 'where', 'setParameters', 'groupBy']) qb[m] = jest.fn(() => qb);
    qb.getRawMany = jest.fn(async () => [row]);
    const projectRepo = { findOne: jest.fn(async () => ({ id: 'P1', projectType: 'SMM', tariffId: 'T1', customTariff: null })) };
    const tariffRepo = { findOne: jest.fn(async () => ({ id: 'T1', isCustom: false, storiesPerMonth: 10, reelsPerMonth: 0, postsPerMonth: 0, designsPerMonth: 0 })) };
    const cpiRepo = { createQueryBuilder: jest.fn(() => qb) };
    const svc = new RiskAnalyticsService(projectRepo as any, {} as any, cpiRepo as any, tariffRepo as any, {} as any);
    return { svc, qb };
  }

  it('план-факт: перерасход — по публикациям текущего месяца, а не за всё время', async () => {
    const { svc, qb } = planFactService({ contentType: 'story', planned: '40', actual: '35', actualMonth: '8', cancelled: '0' });
    const [row] = await svc.getPlanFactRich('P1');
    expect(row).toMatchObject({ contentType: 'story', actual: 35, actualMonth: 8, tariffLimit: 10, overuse: 0, underuse: 2, percent: 80 });
    const params = qb.setParameters.mock.calls[0][0];
    expect(params.monthFrom).toBeInstanceOf(Date);
    expect(params.monthTo).toBeInstanceOf(Date);

    const over = planFactService({ contentType: 'story', planned: '40', actual: '35', actualMonth: '12', cancelled: '0' });
    const [row2] = await over.svc.getPlanFactRich('P1');
    expect(row2.overuse).toBe(2);
  });

  it('риск проекта: SMM без задач не получает «нет новых задач»; перерасход — помесячно', () => {
    const svc = new RiskAnalyticsService({} as any, {} as any, {} as any, {} as any, {} as any);
    const tariff = { id: 'T1', isCustom: false, storiesPerMonth: 10, reelsPerMonth: 0, postsPerMonth: 0, designsPerMonth: 0 } as any;
    const calc = (project: any, actualMonth: number) => (svc as any).computeProjectRiskSync(
      project, [], [], [{ contentType: 'story', planned: 50, actual: 50, actualMonth }], 50, tariff, new Set<string>(),
    );
    const smm = { id: 'P1', name: 'SMM', projectType: 'SMM', tariffId: 'T1', customTariff: null };
    const keys = (r: any) => r.factors.map((f: any) => f.key);
    const triggered = (r: any, key: string) => r.factors.find((f: any) => f.key === key)?.triggered;

    expect(keys(calc(smm, 5))).not.toContain('no_week_tasks');
    expect(triggered(calc(smm, 5), 'tariff_overuse')).toBe(false);
    expect(triggered(calc(smm, 11), 'tariff_overuse')).toBe(true);

    const dev = { id: 'P2', name: 'Сайт', projectType: 'Лендинг', tariffId: null, customTariff: null };
    expect(triggered(calc(dev, 0), 'no_week_tasks')).toBe(true);
  });
});
