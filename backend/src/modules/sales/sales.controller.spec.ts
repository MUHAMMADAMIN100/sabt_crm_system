import { ForbiddenException } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { isSalesOwner } from './sales-access';

/** «Продажи» — только основателю (21.11.2026): аналитику продаж админ не
 *  получает и по прямому запросу. Право clients.kpi.all у админа остаётся —
 *  на нём KPI менеджеров в «Базе клиентов», — поэтому проверка своя. */

const FOUNDER = { id: 'f', role: 'founder', secondaryRole: null };
const ADMIN = { id: 'a', role: 'admin', secondaryRole: null };

function make() {
  const analytics = { analytics: jest.fn(async () => ({ ok: true })) };
  const ctrl = new SalesController({} as any, analytics as any);
  return { ctrl, analytics };
}

describe('GET /sales/analytics — только основатель', () => {
  it('основатель получает аналитику с теми же параметрами', async () => {
    const { ctrl, analytics } = make();
    await expect(ctrl.analytics('2026-11-01', '2026-11-30', 'smm', { user: FOUNDER })).resolves.toEqual({ ok: true });
    expect(analytics.analytics).toHaveBeenCalledWith('2026-11-01', '2026-11-30', 'smm');
  });

  it('админу и руководителю направления — 403, сервис не вызывается', async () => {
    const { ctrl, analytics } = make();
    await expect(ctrl.analytics(undefined, undefined, undefined, { user: ADMIN })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.analytics(undefined, undefined, undefined, { user: { id: 'd', role: 'smm_director' } }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(analytics.analytics).not.toHaveBeenCalled();
  });
});

describe('isSalesOwner', () => {
  it('основатель — да; админ, помощник админа, руководители, МП — нет', () => {
    expect(isSalesOwner(FOUNDER)).toBe(true);
    expect(isSalesOwner(ADMIN)).toBe(false);
    expect(isSalesOwner({ id: 'd', role: 'smm_director' })).toBe(false);
    expect(isSalesOwner({ id: 'm', role: 'sales_manager_smm' })).toBe(false);
    expect(isSalesOwner(null)).toBe(false);
  });
});
