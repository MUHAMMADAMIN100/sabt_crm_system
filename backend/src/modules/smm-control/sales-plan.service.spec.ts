import { Logger } from '@nestjs/common';
import { SalesPlanService } from './sales-plan.service';

/** Окошко «План продаж» менеджера (15.11.2026, SALES_SPEC §6): комиссия из
 *  «Настроек продаж» и история за 6 прошлых месяцев. */
const ME = '0f0f0f0f-0000-4000-8000-000000000001';

function make(opts: { plan?: number | null; past?: Array<{ ym: string; amount: number }>; commission?: Record<string, number> | null; received?: Record<string, number> }) {
  const svc: any = Object.create(SalesPlanService.prototype);
  svc.logger = new Logger('test');
  svc.repo = {
    findOne: jest.fn(async () => (opts.plan == null ? null : { userId: ME, ym: '2026-11', amount: String(opts.plan) })),
    find: jest.fn(async () => (opts.past || []).map(p => ({ userId: ME, ym: p.ym, amount: String(p.amount) }))),
  };
  svc.payments = { receivedByMonth: jest.fn(async () => opts.received || {}) };
  svc.ds = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM sales_settings')) {
        return opts.commission ? [{ key: 'commission', value: opts.commission }] : [];
      }
      return [];
    }),
  };
  return svc as SalesPlanService;
}

describe('SalesPlanService.mine — комиссия и история', () => {
  beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-11-15T06:00:00Z') }); });
  afterAll(() => { jest.useRealTimers(); });

  it('с планом: прежние поля, комиссия от полученного (до целых сомони) и 6 месяцев истории', async () => {
    const svc = make({
      plan: 50000,
      past: [{ ym: '2026-10', amount: 40000 }, { ym: '2026-06', amount: 30000 }],
      commission: { [ME]: 7.5 },
      received: { '2026-05': 1000, '2026-06': 28000, '2026-10': 41000, '2026-11': 12345 },
    });
    const res: any = await svc.mine({ id: ME, role: 'sales_manager_smm' });
    expect(res).toMatchObject({ ym: '2026-11', plan: 50000, received: 12345, day: 15, daysInMonth: 30, daysLeft: 15 });
    expect(res.commissionPercent).toBe(7.5);
    expect(res.commissionAmount).toBe(926); // 12345 × 7.5 % = 925.875
    expect(res.history).toEqual([
      { ym: '2026-05', plan: null, received: 1000 },
      { ym: '2026-06', plan: 30000, received: 28000 },
      { ym: '2026-07', plan: null, received: 0 },
      { ym: '2026-08', plan: null, received: 0 },
      { ym: '2026-09', plan: null, received: 0 },
      { ym: '2026-10', plan: 40000, received: 41000 },
    ]);
    expect((svc as any).payments.receivedByMonth).toHaveBeenCalledWith(ME, '2026-05', '2026-11');
  });

  it('без комиссии — null; без плана — plan: null, но история и получено есть', async () => {
    const res: any = await make({ plan: null, received: { '2026-11': 500 } }).mine({ id: ME });
    expect(res.plan).toBeNull();
    expect(res.received).toBe(500);
    expect(res.commissionPercent).toBeNull();
    expect(res.commissionAmount).toBeNull();
    expect(res.history).toHaveLength(6);
  });

  it('комиссия другого менеджера не подхватывается', async () => {
    const res: any = await make({ plan: 1000, commission: { '0f0f0f0f-0000-4000-8000-000000000002': 10 } }).mine({ id: ME });
    expect(res.commissionPercent).toBeNull();
  });
});
