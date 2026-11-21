import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SalesAnalyticsService } from './sales-analytics.service';
import { mergeCommission, mergeNorms } from './sales-settings.logic';
import { DEFAULT_SALES_NORMS } from '../clients/sales-settings';

// Настройки и аналитика продаж на заглушках (15.11.2026).

const NOW = new Date('2026-11-15T10:00:00Z');
const MP = { id: '11111111-1111-1111-1111-111111111111', name: 'Фарход', role: 'sales_manager_smm', secondaryRole: null };
const MP_DEV = { id: '22222222-2222-2222-2222-222222222222', name: 'Нигина', role: 'designer', secondaryRole: 'sales_manager_dev' };
const FOUNDER = { id: '99999999-9999-9999-9999-999999999999', name: 'Основатель', role: 'founder', secondaryRole: null };
const ADMIN = { id: '88888888-8888-8888-8888-888888888888', name: 'Админ', role: 'admin', secondaryRole: null };

type Responder = (sql: string, params: any[]) => any;

function makeService(opts: { respond?: Responder; users?: any[]; plans?: any[] } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const store: Record<string, any> = {};
  const respond = opts.respond ?? (() => []);
  const manager = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM sales_settings')) {
        return Object.entries(store).map(([key, value]) => ({ key, value }));
      }
      if (sql.includes('INSERT INTO sales_settings')) {
        store[params[0]] = JSON.parse(params[1]);
        return [];
      }
      return respond(sql, params);
    }),
  };
  const leadRepo: any = { manager };
  const userRepo: any = { find: jest.fn(async () => opts.users ?? [MP, MP_DEV]) };
  const planRepo: any = { find: jest.fn(async () => opts.plans ?? []) };
  const clients: any = { kpi: jest.fn(async () => ({ overallPercent: 64, restDay: false })) };
  const payments: any = { receivedOf: jest.fn(async () => 1000) };
  const svc = new SalesAnalyticsService(leadRepo, userRepo, planRepo, clients, payments);
  return { svc, calls, store, clients, payments, planRepo };
}

beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('GET /sales/settings', () => {
  it('руководство — нормы, вся комиссия и менеджеры (вторая роль МП — тоже)', async () => {
    const t = makeService();
    t.store.commission = { [MP.id]: 5, [MP_DEV.id]: 3 };
    const s = await t.svc.getSettings(FOUNDER);
    expect(s.norms.smm).toEqual(DEFAULT_SALES_NORMS);
    expect(s.commission).toEqual({ [MP.id]: 5, [MP_DEV.id]: 3 });
    expect(s.managers).toEqual([
      { id: MP.id, name: MP.name, role: 'sales_manager_smm' },
      { id: MP_DEV.id, name: MP_DEV.name, role: 'sales_manager_dev' },
    ]);
  });

  it('админ — как менеджер: нормы без чужой комиссии и списка менеджеров (21.11.2026)', async () => {
    const t = makeService();
    t.store.commission = { [MP.id]: 5, [MP_DEV.id]: 3 };
    const s = await t.svc.getSettings(ADMIN);
    expect(s.norms.smm).toEqual(DEFAULT_SALES_NORMS);
    expect(s.commission).toEqual({});
    expect(s.managers).toEqual([]);
  });

  it('МП — нормы и только свой процент, без списка менеджеров', async () => {
    const t = makeService();
    t.store.commission = { [MP.id]: 5, [MP_DEV.id]: 3 };
    const s = await t.svc.getSettings(MP);
    expect(s.commission).toEqual({ [MP.id]: 5 });
    expect(s.managers).toEqual([]);
    const other = await t.svc.getSettings({ ...MP, id: '33333333-3333-3333-3333-333333333333' });
    expect(other.commission).toEqual({});
  });
});

describe('PUT /sales/settings — кто что меняет', () => {
  it('нормы — только основатель (21.11.2026); админу и МП — 403', async () => {
    const founder = makeService();
    const s = await founder.svc.saveSettings(FOUNDER, { norms: { smm: { cold_calls: 30 } } });
    expect(s.norms.smm.cold_calls).toBe(30);
    expect(s.norms.development).toEqual(DEFAULT_SALES_NORMS);
    expect(founder.store.kpi_norms.smm.cold_calls).toBe(30);

    const admin = makeService();
    await expect(admin.svc.saveSettings(ADMIN, { norms: { smm: { cold_calls: 30 } } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.store.kpi_norms).toBeUndefined();

    const mp = makeService();
    await expect(mp.svc.saveSettings(MP, { norms: { smm: { cold_calls: 30 } } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mp.store.kpi_norms).toBeUndefined();
  });

  it('комиссия — только основатель: админу 403, и нормы из того же запроса не сохраняются', async () => {
    const t = makeService();
    await expect(t.svc.saveSettings(ADMIN, { norms: { smm: { meetings: 3 } }, commission: { [MP.id]: 5 } }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(t.store.kpi_norms).toBeUndefined();
    expect(t.store.commission).toBeUndefined();
  });

  it('основатель ставит и снимает комиссию; чужим (не МП) — 400', async () => {
    const t = makeService();
    t.store.commission = { [MP_DEV.id]: 3 };
    const s = await t.svc.saveSettings(FOUNDER, { commission: { [MP.id]: '7.5', [MP_DEV.id]: null } });
    expect(s.commission).toEqual({ [MP.id]: 7.5 });
    await expect(t.svc.saveSettings(FOUNDER, { commission: { [ADMIN.id]: 5 } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('мусор — 400 и ничего не записано; пустое тело — 400', async () => {
    const t = makeService();
    await expect(t.svc.saveSettings(FOUNDER, { norms: { smm: { cold_calls: 600 } } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.saveSettings(FOUNDER, { norms: { smm: { cold_calls: 30 } }, commission: { [MP.id]: 150 } }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(t.store).toEqual({});
    await expect(t.svc.saveSettings(FOUNDER, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('mergeNorms / mergeCommission', () => {
  const cur = { smm: { ...DEFAULT_SALES_NORMS }, development: { ...DEFAULT_SALES_NORMS } };

  it('нормы: частичная правка, целые 0..500, неизвестное — 400', () => {
    expect(mergeNorms(cur, { development: { meetings: 0 } }).development.meetings).toBe(0);
    expect(() => mergeNorms(cur, { smm: { meetings: 2.5 } })).toThrow(BadRequestException);
    expect(() => mergeNorms(cur, { smm: { calls: 5 } })).toThrow(BadRequestException);
    expect(() => mergeNorms(cur, { design: {} })).toThrow(BadRequestException);
    expect(() => mergeNorms(cur, [])).toThrow(BadRequestException);
  });

  it('комиссия: 0 и null снимают, >100 и не-uuid — 400, два знака', () => {
    const id = MP.id;
    expect(mergeCommission({ [id]: 5 }, { [id]: 0 })).toEqual({});
    expect(mergeCommission({}, { [id]: 3.333 })).toEqual({ [id]: 3.33 });
    expect(() => mergeCommission({}, { [id]: 101 })).toThrow(BadRequestException);
    expect(() => mergeCommission({}, { 'not-a-uuid': 5 })).toThrow(BadRequestException);
  });
});

describe('GET /sales/analytics — сборка ответа', () => {
  const respond: Responder = (sql) => {
    if (sql.includes('c."leadSource", c."createdAt"')) {
      return [
        { id: 'l1', status: 'won', ownerId: MP.id, leadSource: 'Instagram', createdAt: new Date('2026-11-02T05:00:00Z') },
        { id: 'l2', status: 'lost', ownerId: MP.id, leadSource: 'Instagram', createdAt: new Date('2026-11-03T05:00:00Z') },
        { id: 'l3', status: 'waiting', ownerId: MP_DEV.id, leadSource: null, createdAt: new Date('2026-11-04T05:00:00Z') },
        { id: 'l4', status: 'new', ownerId: null, leadSource: null, createdAt: new Date('2026-11-05T05:00:00Z') },
      ];
    }
    if (sql.includes('FROM lead_progress WHERE lead_id = ANY')) return [{ leadId: 'l2', statusTo: 'meeting', stageTo: null }];
    if (sql.includes(`WHERE c.status::text = 'won'`)) {
      return [{ createdAt: new Date('2026-11-02T05:00:00Z'), wonAt: new Date('2026-11-12T05:00:00Z') }];
    }
    if (sql.includes(`c.status::text = 'lost'`)) return [{ lostReason: 'price' }];
    if (sql.includes('"expectedCloseAt" BETWEEN')) return [];
    if (sql.includes(`kind = 'meeting'`)) return [{ userId: MP.id, c: 4 }];
    return [];
  };

  it('итоги, воронка, источники, менеджеры; план и «получено» — за целый месяц', async () => {
    const t = makeService({ respond, plans: [{ userId: MP.id, ym: '2026-11', amount: '20000.00' }] });
    const a = await t.svc.analytics('2026-11-01', '2026-11-30');
    expect(a.period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(a.totals).toEqual({
      leads: 4, won: 1, conversion: 25, cycleDaysMedian: 10, received: 2000, plan: 20000, expected: null,
    });
    expect(a.funnel.map(f => f.count)).toEqual([4, 3, 2, 1, 1, 1]);
    expect(a.bySource[0]).toEqual({ source: 'Instagram', leads: 2, won: 1, conversion: 50 });
    expect(a.lostReasons).toEqual([{ reason: 'price', count: 1 }]);
    const mp = a.byManager.find(m => m.userId === MP.id)!;
    expect(mp).toEqual({
      userId: MP.id, name: MP.name, role: 'sales_manager_smm',
      leads: 2, meetingsHeld: 4, won: 1, received: 1000, plan: 20000, kpiPercent: 64,
    });
    const dev = a.byManager.find(m => m.userId === MP_DEV.id)!;
    expect(dev.plan).toBeNull();
    expect(dev.role).toBe('sales_manager_dev');
    // KPI — по направлению менеджера.
    expect(t.clients.kpi).toHaveBeenCalledWith(MP_DEV.id, 'development', '2026-11-01', '2026-11-30');
    expect(t.payments.receivedOf).toHaveBeenCalledWith(MP.id, '2026-11');
  });

  it('неделя — без плана и «получено» (null), KPI выходного — null', async () => {
    const t = makeService({ respond });
    t.clients.kpi.mockResolvedValue({ overallPercent: 0, restDay: true });
    const a = await t.svc.analytics('2026-11-09', '2026-11-15');
    expect(a.totals.received).toBeNull();
    expect(a.totals.plan).toBeNull();
    expect(a.byManager.every(m => m.received === null && m.plan === null && m.kpiPercent === null)).toBe(true);
    expect(t.payments.receivedOf).not.toHaveBeenCalled();
    expect(t.planRepo.find).not.toHaveBeenCalled();
  });

  it('фильтр направления — только менеджеры направления; неверное направление — 400', async () => {
    const t = makeService({ respond });
    const a = await t.svc.analytics('2026-11-01', '2026-11-30', 'development');
    expect(a.byManager.map(m => m.userId)).toEqual([MP_DEV.id]);
    expect(t.calls.find(c => c.sql.includes('c."createdAt" BETWEEN'))!.params[2]).toBe('development');
    await expect(t.svc.analytics('2026-11-01', '2026-11-30', 'design')).rejects.toBeInstanceOf(BadRequestException);
  });
});
