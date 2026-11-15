import { Logger } from '@nestjs/common';
import { SmmPaymentsService } from './smm-payments.service';

// Деньги менеджера по продажам (14.11.2026): не теряются, не считаются
// дважды и не переезжают задним числом. Сервис целиком, база — подставная.

type Row = Record<string, any>;
const clients: Row[] = [
  { id: 'f-chrono', name: 'Chrono', direction: 'smm', tariff: 4000, contractDate: '2026-06-03', cycleAnchor: '2026-11-03', archived: false, status: 'active', retentionMonths: null, salesManagerId: null, salesManagerHistory: null },
  { id: 'f-old', name: 'Ушедший', direction: 'smm', tariff: 1000, contractDate: '2026-05-10', cycleAnchor: '2026-10-10', archived: true, status: 'active', retentionMonths: null, salesManagerId: null, salesManagerHistory: null },
  { id: 'f-dev', name: 'Alif', direction: 'development', tariff: 30000, contractDate: '2026-09-01', cycleAnchor: null, archived: false, status: 'active', retentionMonths: null, salesManagerId: 'D', salesManagerHistory: null },
];
const plans: Row[] = [
  // Chrono: 3-го платил при менеджере A, 20-го — уже при B, остаток ждём 25-го.
  { id: 'p1', projectId: 'f-chrono', ym: '2026-11', partNo: 1, status: 'received', dueDate: '2026-11-03', amount: 2000, paidAt: '2026-11-03', receivedTxId: 't1' },
  { id: 'p2', projectId: 'f-chrono', ym: '2026-11', partNo: 2, status: 'received', dueDate: '2026-11-18', amount: 1500, paidAt: '2026-11-20', receivedTxId: 't2' },
  { id: 'p3', projectId: 'f-chrono', ym: '2026-11', partNo: 2, status: 'expected', dueDate: '2026-11-25', amount: 500, paidAt: null, receivedTxId: null },
  // Архивный клиент заплатил последний раз 10 ноября.
  { id: 'p4', projectId: 'f-old', ym: '2026-11', partNo: 1, status: 'received', dueDate: '2026-11-10', amount: 800, paidAt: '2026-11-10', receivedTxId: 't4' },
  // Разработка «Alif».
  { id: 'p5', projectId: 'f-dev', ym: '2026-11', partNo: 1, status: 'received', dueDate: '2026-11-12', amount: 5000, paidAt: '2026-11-12', receivedTxId: 't5' },
];
const projects: Row[] = [
  { id: 'crm-chrono', name: 'Chrono', projectType: 'SMM', isArchived: false, status: 'active',
    smmData: { salesManagerId: 'B', salesManagerHistory: [{ managerId: 'A', from: '2026-06-01' }, { managerId: 'B', from: '2026-11-15' }] } },
  { id: 'crm-old', name: 'Ушедший', projectType: 'SMM', isArchived: true, status: 'archived', smmData: { salesManagerId: 'A' } },
  // SMM-проект с тем же названием, что клиент разработки: раньше его деньги
  // доставались и менеджеру A.
  { id: 'crm-alif', name: 'Alif', projectType: 'SMM', isArchived: false, status: 'active', smmData: { salesManagerId: 'A' } },
];

function make() {
  const svc: any = Object.create(SmmPaymentsService.prototype);
  svc.logger = new Logger('test');
  svc.projectRepo = {
    find: jest.fn(async ({ where }: any) => projects.filter(p => where?.isArchived === false ? !p.isArchived : true)),
    findOne: jest.fn(async ({ where }: any) => projects.find(p => p.id === where.id) || null),
    update: jest.fn(),
  };
  const updates: any[][] = [];
  svc.ds = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (/^\s*UPDATE finance_projects/.test(sql)) { updates.push(params); return []; }
      if (sql.includes('FROM finance_projects')) return clients;
      if (sql.includes('FROM finance_planned_payments')) return plans.filter(x => params[0].includes(x.projectId));
      if (sql.includes('FROM finance_transactions')) return [];
      if (sql.includes('FROM users')) return [{ role: 'sales_manager_dev', secondaryRole: null, isActive: true }];
      return [];
    }),
  };
  return { svc: svc as SmmPaymentsService, updates };
}

describe('SmmPaymentsService — чьи деньги', () => {
  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-11-21T06:00:00Z') }); });
  afterAll(() => { jest.useRealTimers(); });

  it('план продаж: смена менеджера 15-го не переносит прошлое, архивный клиент не пропал, разработка не задвоилась', async () => {
    const { svc } = make();
    expect(await svc.receivedOf('A', '2026-11')).toBe(2800); // 2000 при нём + 800 архивного
    expect(await svc.receivedOf('B', '2026-11')).toBe(1500);
    expect(await svc.receivedOf('D', '2026-11')).toBe(5000);
  });

  it('«Панель»: «получено за месяц» — те же деньги, что факт плана; ожидаемое — только текущему', async () => {
    const { svc } = make();
    for (const id of ['A', 'B', 'D']) {
      const cal = await svc.calendar({ id, role: 'sales_manager_smm' }, '2026-11-01', '2026-11-30');
      const got = cal.items.filter(i => i.state === 'paid').reduce((s, i) => s + i.amount, 0);
      expect(got).toBe(await svc.receivedOf(id, '2026-11'));
    }
    const a = await svc.calendar({ id: 'A', role: 'sales_manager_smm' }, '2026-11-01', '2026-11-30');
    expect(a.items.map(i => i.key)).toEqual(['plan:p1', 'plan:p4']);
    const b = await svc.calendar({ id: 'B', role: 'sales_manager_smm' }, '2026-11-01', '2026-11-30');
    expect(b.items.map(i => [i.key, i.state])).toEqual([['plan:p2', 'paid'], ['plan:p3', 'wait']]);
    expect(b.clients).toBe(1);
  });

  it('«Календарь»: те же оплаты без сумм; клиент разработки ведёт на «Панель»', async () => {
    const { svc } = make();
    const a = await svc.forManager('A', '2026-11-01', '2026-11-30');
    expect(a.map(i => [i.projectId, i.date, i.state])).toEqual([
      ['crm-chrono', '2026-11-03', 'paid'],
      ['crm-old', '2026-11-10', 'paid'],
    ]);
    expect(a[0]).not.toHaveProperty('amount');
    const d = await svc.forManager('D', '2026-11-01', '2026-11-30');
    expect(d).toEqual([expect.objectContaining({ projectId: null, projectName: 'Alif', date: '2026-11-12', state: 'paid', paidAt: '2026-11-12' })]);
  });

  it('карточка проекта и «Контроль» — по тем же оплатам', async () => {
    const { svc } = make();
    const card: any = await svc.project('crm-chrono', { id: 'f', role: 'founder' });
    expect(card.next).toMatchObject({ date: '2026-11-25', state: 'wait', partNo: 2 });
    expect(card.lastPaid).toMatchObject({ date: '2026-11-20', state: 'paid', paidAt: '2026-11-20' });
    const states = await svc.monthStates([projects[0] as any, projects[2] as any], '2026-11');
    expect(states.get('crm-chrono')).toBe('wait');
    // CRM «Alif» не связан с клиентом разработки по названию
    expect(states.has('crm-alif')).toBe(false);
  });

  it('суммы в календаре — только у права finance.manage и у менеджера по своим клиентам (15.11.2026)', async () => {
    const { svc } = make();
    const amounts = (cal: any) => cal.items.map((i: any) => i.amount);
    // Админ без «Финансов»: календарь всех клиентов, но без денег.
    const admin: any = await svc.calendar({ id: 'adm', role: 'admin' }, '2026-11-01', '2026-11-30');
    expect(admin.money).toBe('none');
    expect(admin.items.length).toBeGreaterThan(0);
    expect(amounts(admin).every((a: any) => a === null)).toBe(true);
    // Админу выдали «Финансы — доступ» — суммы видны.
    const granted: any = await svc.calendar({ id: 'adm', role: 'admin', extraPermissions: ['finance.manage'], deniedPermissions: [] }, '2026-11-01', '2026-11-30');
    expect(granted.money).toBe('all');
    expect(amounts(granted).every((a: any) => typeof a === 'number')).toBe(true);
    // Основатель — суммы есть; запрет сильнее роли.
    const founder: any = await svc.calendar({ id: 'f', role: 'founder' }, '2026-11-01', '2026-11-30');
    expect(founder.money).toBe('all');
    const denied: any = await svc.calendar({ id: 'f', role: 'founder', deniedPermissions: ['finance.manage'] }, '2026-11-01', '2026-11-30');
    expect(denied.money).toBe('none');
    expect(amounts(denied).every((a: any) => a === null)).toBe(true);
    // Менеджер: свои суммы видны; отняли «Оплаты проекта — просмотр» — нет.
    const b: any = await svc.calendar({ id: 'B', role: 'sales_manager_smm' }, '2026-11-01', '2026-11-30');
    expect(b.money).toBe('own');
    expect(amounts(b)).toEqual([1500, 500]);
    const bDenied: any = await svc.calendar({ id: 'B', role: 'sales_manager_smm', deniedPermissions: ['projects.payments.view'] }, '2026-11-01', '2026-11-30');
    expect(amounts(bDenied)).toEqual([null, null]);
    expect(bDenied.items[0]).not.toHaveProperty('own');
  });

  it('смена менеджера клиента разработки пишет историю', async () => {
    const { svc, updates } = make();
    await svc.setClientManager('f-dev', 'E', { id: 'f', role: 'founder' }).catch(() => null);
    expect(updates[0][0]).toBe('E');
    expect(JSON.parse(updates[0][1])).toEqual([{ managerId: 'D', from: '2026-09-01' }, { managerId: 'E', from: '2026-11-21' }]);
  });
});
