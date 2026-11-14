import { RiskAlertsService } from './risk-alerts.service';
import { NotificationType } from '../notifications/notification.entity';

/** Риск-алерты: менеджеры продаж не получают шум по старым данным. */

const USERS = [
  { id: 'D1', name: 'Дизайнер', role: 'designer', secondaryRole: null },
  { id: 'S1', name: 'МП СММ', role: 'sales_manager_smm', secondaryRole: null },
  { id: 'S2', name: 'Вторая роль', role: 'designer', secondaryRole: 'sales_manager_dev' },
  { id: 'F1', name: 'Основатель', role: 'founder', secondaryRole: null },
];
const ADMINS = [{ id: 'A1', name: 'Админ', role: 'admin', secondaryRole: null }];

function setup() {
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
    manager: { query: jest.fn(async () => [{ id: 'E1', userId: 'D1' }]) },
  };
  const taskRepo = { createQueryBuilder: jest.fn(() => taskQb) };
  const notifications = { createIfNotRecent: jest.fn(async () => true) };
  const riskAnalytics = { getPmWorkload: jest.fn(async () => []), getEmployeeWorkload: jest.fn(async () => []) };
  const s = new RiskAlertsService(
    projectRepo as any, taskRepo as any, {} as any, userRepo as any, notifications as any, riskAnalytics as any, {} as any,
  );
  return { s, notifications, taskQb };
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

  it('runAll: оплат по старым полям нет — никому, и менеджерам продаж ничего', async () => {
    const { s, notifications } = setup();
    await s.runAll();
    const sent = notifications.createIfNotRecent.mock.calls.map((c: any[]) => c[0]);
    expect(sent.filter((n: any) => [NotificationType.PAYMENT_OVERDUE_SOON, NotificationType.PAYMENT_REMINDER].includes(n.type))).toEqual([]);
    expect(sent.filter((n: any) => ['S1', 'S2'].includes(n.userId))).toEqual([]);
  });
});
