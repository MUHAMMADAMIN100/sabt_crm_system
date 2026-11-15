import { Logger } from '@nestjs/common';
import { SmmPaymentsService } from './smm-payments.service';
import { financeDirectionOf, resolveProjectClient } from './smm-payments.logic';

// «Продажи, этап 2» (15.11.2026): долг клиента для письма «Запрос оплаты» —
// из «Финансов»; история «получено» плана продаж — тем же правилом, что
// текущий месяц.

type Row = Record<string, any>;
const clients: Row[] = [
  { id: 'f-chrono', name: 'Chrono', direction: 'smm', tariff: 4000, contractDate: '2026-06-03', cycleAnchor: '2026-11-03', archived: false, status: 'active', retentionMonths: null, salesManagerId: null, salesManagerHistory: null },
  { id: 'f-dev', name: 'Сайт Alif', direction: 'development', tariff: 0, contractDate: '2026-09-01', cycleAnchor: null, archived: false, status: 'active', retentionMonths: null, salesManagerId: 'D', salesManagerHistory: null },
];
const plans: Row[] = [
  // Chrono: ноябрь — первая часть получена, вторая просрочена (срок 18-го).
  { id: 'p1', projectId: 'f-chrono', ym: '2026-11', partNo: 1, status: 'received', dueDate: '2026-11-03', amount: 2000, paidAt: '2026-11-03', receivedTxId: 't1' },
  { id: 'p2', projectId: 'f-chrono', ym: '2026-11', partNo: 2, status: 'expected', dueDate: '2026-11-18', amount: 2000, paidAt: null, receivedTxId: null },
  // Октябрь оплачен целиком.
  { id: 'p0', projectId: 'f-chrono', ym: '2026-10', partNo: 1, status: 'received', dueDate: '2026-10-03', amount: 4000, paidAt: '2026-10-04', receivedTxId: 't0' },
  // Разработка: срок сегодня.
  { id: 'p5', projectId: 'f-dev', ym: '2026-11', partNo: 1, status: 'expected', dueDate: '2026-11-21', amount: 15000, paidAt: null, receivedTxId: null },
];
const projects: Row[] = [
  { id: 'crm-chrono', name: 'Chrono', projectType: 'SMM', isArchived: false, status: 'active', smmData: { salesManagerId: 'B' } },
];

function make() {
  const svc: any = Object.create(SmmPaymentsService.prototype);
  svc.logger = new Logger('test');
  svc.projectRepo = {
    find: jest.fn(async ({ where }: any) => projects.filter(p => (where?.isArchived === false ? !p.isArchived : true))),
    findOne: jest.fn(async ({ where }: any) => projects.find(p => p.id === where.id) || null),
  };
  svc.ds = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM finance_projects')) return clients;
      if (sql.includes('FROM finance_planned_payments')) return plans.filter(x => params[0].includes(x.projectId));
      return [];
    }),
  };
  return svc as SmmPaymentsService;
}

describe('SmmPaymentsService — долг клиента по «Финансам»', () => {
  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-11-21T06:00:00Z') }); });
  afterAll(() => { jest.useRealTimers(); });

  it('SMM: к оплате — просроченная вторая часть, оплачено — первая того же месяца', async () => {
    const debt = await make().projectDebt({ id: 'crm-chrono', name: 'Chrono', projectType: 'SMM', smmData: {} } as any);
    expect(debt).toMatchObject({ client: { id: 'f-chrono', by: 'name' }, remaining: 2000, paid: 2000, total: 4000 });
    expect(debt!.items).toEqual([{ date: '2026-11-18', ym: '2026-11', amount: 2000, partNo: 2, state: 'late' }]);
  });

  it('разработка: клиент находится по названию своего направления, срок сегодня — тоже долг', async () => {
    const debt = await make().projectDebt({ id: 'crm-dev', name: 'Сайт Alif', projectType: 'Лендинг', smmData: null } as any);
    expect(debt).toMatchObject({ client: { id: 'f-dev' }, remaining: 15000, paid: 0, total: 15000 });
    expect(debt!.items[0].state).toBe('today');
  });

  it('проект без клиента в «Финансах» — null', async () => {
    expect(await make().projectDebt({ id: 'x', name: 'Нет такого', projectType: 'SMM', smmData: {} } as any)).toBeNull();
  });

  it('«получено» по месяцам — те же суммы, что receivedOf по каждому месяцу', async () => {
    const svc = make();
    const byMonth = await svc.receivedByMonth('B', '2026-09', '2026-11');
    expect(byMonth).toEqual({ '2026-09': 0, '2026-10': 4000, '2026-11': 2000 });
    for (const ym of ['2026-10', '2026-11']) expect(byMonth[ym]).toBe(await svc.receivedOf('B', ym));
  });
});

describe('resolveProjectClient — клиент «Финансов» проекта любого направления', () => {
  const c = (id: string, name: string, direction: string, archived = false) => ({ id, name, direction, archived });

  it('направление по типу проекта', () => {
    expect(financeDirectionOf('SMM')).toBe('smm');
    expect(financeDirectionOf('Лендинг')).toBe('development');
    expect(financeDirectionOf('Web сайт')).toBe('development');
    expect(financeDirectionOf('Дизайн')).toBe('design');
    expect(financeDirectionOf('Другое')).toBeNull();
  });

  it('разработка не берёт клиента SMM с тем же названием и не гадает между двумя', () => {
    const list = [c('s', 'Alif', 'smm'), c('d', 'Alif', 'development')];
    expect(resolveProjectClient({ id: 'p', name: 'Alif', projectType: 'CRM система' }, list)?.client.id).toBe('d');
    expect(resolveProjectClient({ id: 'p', name: 'Alif', projectType: 'SMM' }, list)?.client.id).toBe('s');
    const twins = [c('d1', 'Alif', 'development'), c('d2', 'alif', 'development')];
    expect(resolveProjectClient({ id: 'p', name: 'Alif', projectType: 'Лендинг' }, twins)).toBeNull();
  });

  it('ручная связь важнее названия; живой клиент важнее архивного', () => {
    const list = [c('d', 'Alif', 'development'), c('m', 'Другое имя', 'development'), c('old', 'Alif', 'development', true)];
    expect(resolveProjectClient({ id: 'p', name: 'Alif', projectType: 'Лендинг', financeProjectId: 'm' }, list))
      .toEqual({ client: list[1], by: 'manual' });
    expect(resolveProjectClient({ id: 'p', name: 'Alif', projectType: 'Лендинг' }, list)?.client.id).toBe('d');
  });
});
