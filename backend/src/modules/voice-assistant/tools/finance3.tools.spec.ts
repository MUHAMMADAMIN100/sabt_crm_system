import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import {
  FINANCE3_TOOLS, assetUpdate, categoryAdd, categoryDelete, categoryRename, financeCategories, forecastAdjustmentRemove,
  forecastAdjustmentUpdate, installmentPay, installmentPayments, salaryMonthClose, salaryMonthReopen,
} from './finance3.tools';
import { ToolContext } from './types';

type Handler = (body?: any, query?: any) => any;

function fakeApi(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body?: any; query?: any }> = [];
  const hit = (method: string, path: string, body?: any, query?: any) => {
    calls.push({ method, path, body, query });
    const h = routes[`${method} ${path}`];
    if (!h) throw new ApiError(404, `нет маршрута ${method} ${path}`);
    return Promise.resolve().then(() => h(body, query));
  };
  return {
    calls,
    get: (p: string, q?: any) => hit('GET', p, undefined, q),
    post: (p: string, b?: any) => hit('POST', p, b),
    patch: (p: string, b?: any) => hit('PATCH', p, b),
    delete: (p: string, b?: any) => hit('DELETE', p, b),
    request: (m: string, p: string, b?: any) => hit(m, p, b),
  };
}

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: {
      id: 'u1', name: 'Тест', role: 'founder', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api, refs: new RefTable(), today: '2026-11-10', nowTime: '10:00', utterance: 'тест',
  };
}

const ACCOUNTS = [{ id: 'acc-alif', name: 'Alif', key: 'alif' }, { id: 'acc-cash', name: 'Cash', key: 'cash' }];
const entry = (over: Record<string, unknown> = {}) => ({
  ym: '2026-10', date: '2026-11-10', amount: 1000, outstanding: 1000, status: 'planned', frozen: false, ...over,
});
const salaryRow = (over: Record<string, unknown> = {}) => ({
  installment: { id: 'inst-1', name: 'Телефон', method: 'salary', payments: [] },
  employee: { name: 'Фарзона' }, done: false, remaining: 3000, next: { ym: '2026-10' },
  schedule: [entry(), entry({ ym: '2026-11', date: '2026-12-10' })], ...over,
});
const board = (over: Record<string, unknown> = {}) => ({
  rows: [salaryRow()], banks: [], latestOpenYm: '2026-10', today: '2026-11-10', ...over,
});
const bankBoard = (planOver: Record<string, unknown> = {}) => ({
  rows: [], latestOpenYm: '2026-10',
  banks: [{
    id: 'debt-1', name: 'Телефон — Фарзона', bank: 'Алиф', remaining: 3000, done: false, installmentId: 'inst-x',
    next: { id: 'pp-1' },
    plan: [{ id: 'pp-1', date: '2026-11-15', amount: 1000, paid: false, overdue: false, ...planOver }],
  }],
});

/** toLocaleString ставит неразрывные пробелы — для сравнения заменяем на обычные. */
const plain = (s: string) => s.replace(/ /g, ' ');

describe('finance3 tools', () => {
  it('все инструменты только для finance.manage', () => {
    const ctx = ctxWith(fakeApi({}));
    const smm = ctxWith(fakeApi({}), { role: 'smm_specialist' }).user;
    expect(FINANCE3_TOOLS.length).toBe(16);
    for (const t of FINANCE3_TOOLS) {
      expect(t.available?.(ctx.user)).toBe(true);
      expect(t.available?.(smm)).toBe(false);
    }
    expect(new Set(FINANCE3_TOOLS.map((t) => t.name)).size).toBe(FINANCE3_TOOLS.length);
  });

  describe('рассрочки', () => {
    it('список: ближайшие платежи сотрудников и банку с метками', async () => {
      const api = fakeApi({ 'GET /finance/installments': () => ({ ...board(), banks: bankBoard().banks }) });
      const ctx = ctxWith(api);
      const res = await installmentPayments.run({}, ctx);
      expect(res.employees).toHaveLength(2);
      expect(res.employees[0]).toMatchObject({ month: '2026-10', method: 'удерживаем из зарплаты', canPay: true });
      expect(res.banks[0].bank).toBe('Алиф');
      expect(ctx.refs.resolve('B', res.banks[0].ref)?.id).toBe('pp-1');
    });

    it('«из зарплаты»: отмечает удержанным, счёт не нужен, undo снимает отметку', async () => {
      const api = fakeApi({
        'GET /finance/installments': () => board(),
        'POST /finance/installments/inst-1/mark': () => ({ ok: true }),
      });
      const ctx = ctxWith(api);
      const list = await installmentPayments.run({}, ctx);
      const pv = await installmentPay.preview!({ payment: list.employees[0].ref }, ctx);
      expect(pv.split('\n')[0]).toContain('УДЕРЖАНО ИЗ ЗАРПЛАТЫ');
      const out = await installmentPay.run({ payment: list.employees[0].ref }, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ ym: '2026-10', on: true });
      expect(out.undo).toEqual([{ method: 'POST', path: '/finance/installments/inst-1/mark', body: { ym: '2026-10', on: false } }]);
    });

    it('платит отдельно: нужен счёт, деньги на счёт, undo удаляет платёж', async () => {
      const separate = salaryRow({ installment: { id: 'inst-1', name: 'Ноутбук', method: 'separate', payments: [] } });
      let paid = false;
      const api = fakeApi({
        'GET /finance/installments': () => (paid
          ? { ...board(), rows: [salaryRow({ installment: { id: 'inst-1', name: 'Ноутбук', method: 'separate', payments: [{ id: 'pay-9' }] } })] }
          : { ...board(), rows: [separate] }),
        'GET /finance/accounts': () => ACCOUNTS,
        'POST /finance/installments/inst-1/payments': () => { paid = true; return { ok: true }; },
      });
      const ctx = ctxWith(api);
      await expect(installmentPay.preview!({ payment: 'Фарзона' }, ctx)).rejects.toThrow(/Какой счёт/);
      const out = await installmentPay.run({ payment: 'Фарзона', account: 'наличные', amount: 400 }, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ amount: 400, date: '2026-11-10', accountId: 'acc-cash', ym: '2026-10' });
      expect(out.undo).toEqual([{ method: 'DELETE', path: '/finance/installments/inst-1/payments/pay-9' }]);
    });

    it('отказывает: будущая дата, закрытый месяц, замороженный месяц зарплаты', async () => {
      const ctx = ctxWith(fakeApi({
        'GET /finance/installments': () => board({ rows: [salaryRow({ schedule: [entry({ frozen: true }), entry({ ym: '2026-11', status: 'done' })] })] }),
      }));
      await expect(installmentPay.preview!({ payment: 'Фарзона', date: '2030-01-01' }, ctx)).rejects.toThrow(/Будущий/);
      await expect(installmentPay.preview!({ payment: 'Фарзона' }, ctx)).rejects.toThrow(/нельзя отметить/);
      await expect(installmentPay.preview!({ payment: 'Фарзона', month: '2026-11' }, ctx)).rejects.toThrow(/уже закрыт/);
    });

    it('банку: полная оплата получает undo, частичная — нет', async () => {
      const api = fakeApi({
        'GET /finance/installments': () => bankBoard(),
        'GET /finance/accounts': () => ACCOUNTS,
        'POST /finance/planned-payments/pp-1/receive': () => ({ ok: true }),
      });
      const ctx = ctxWith(api);
      const list = await installmentPayments.run({ side: 'banks' }, ctx);
      const pv = plain(await installmentPay.preview!({ payment: list.banks[0].ref, account: 'алиф' }, ctx));
      expect(pv.split('\n')[0]).toBe('🏦 ОПЛАТИТЬ БАНКУ 1 000 сом.');
      const full = await installmentPay.run({ payment: list.banks[0].ref, account: 'алиф' }, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ accountId: 'acc-alif', date: '2026-11-10' });
      expect(full.undo).toEqual([{ method: 'POST', path: '/finance/planned-payments/pp-1/unreceive', body: {} }]);
      const part = await installmentPay.run({ payment: list.banks[0].ref, account: 'алиф', amount: 300 }, ctx);
      expect(part.undo).toBeUndefined();
      await expect(installmentPay.preview!({ payment: list.banks[0].ref, account: 'алиф', amount: 5000 }, ctx)).rejects.toThrow(/Больше платежа/);
    });

    it('неоднозначное имя (сотрудник и банк) — просит уточнить', async () => {
      const api = fakeApi({
        'GET /finance/installments': () => ({ ...board(), banks: [{ ...bankBoard().banks[0], name: 'Телефон — Фарзона' }] }),
      });
      await expect(installmentPay.preview!({ payment: 'Телефон' }, ctxWith(api))).rejects.toThrow(/несколько платежей/);
    });
  });

  describe('статьи', () => {
    const cats = [
      { id: 'c-sys', name: 'Зарплата', type: 'expense', key: 'salary', builtin: true },
      { id: 'c-1', name: 'Канцелярия', type: 'expense', key: null, builtin: false },
    ];

    it('список с метками и признаком системной', async () => {
      const ctx = ctxWith(fakeApi({ 'GET /finance/categories': () => cats }));
      const res = await financeCategories.run({}, ctx);
      expect(res.categories[0]).toMatchObject({ name: 'Зарплата', system: true });
    });

    it('добавить: дубль отклоняется, тело — только поля DTO, undo удаляет', async () => {
      const api = fakeApi({
        'GET /finance/categories': () => cats,
        'POST /finance/categories': () => ({ id: 'c-new' }),
      });
      const ctx = ctxWith(api);
      await expect(categoryAdd.run({ name: 'канцелярия', type: 'expense' }, ctx)).rejects.toThrow(/уже есть/);
      const out = await categoryAdd.run({ name: 'Печать', type: 'expense' }, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Печать', type: 'expense' });
      expect(out.undo).toEqual([{ method: 'DELETE', path: '/finance/categories/c-new' }]);
    });

    it('системные статьи не переименовываются и не удаляются', async () => {
      const ctx = ctxWith(fakeApi({ 'GET /finance/categories': () => cats }));
      await expect(categoryRename.run({ category: 'Зарплата', name: 'ЗП' }, ctx)).rejects.toThrow(/системная/);
      await expect(categoryDelete.preview!({ category: 'Зарплата' }, ctx)).rejects.toThrow(/системная/);
    });

    it('переименование: undo возвращает старое имя; удаление — с подтверждением и без undo', async () => {
      const api = fakeApi({
        'GET /finance/categories': () => cats,
        'PATCH /finance/categories/c-1': () => ({}),
        'DELETE /finance/categories/c-1': () => ({ ok: true }),
      });
      const ctx = ctxWith(api);
      const ren = await categoryRename.run({ category: 'Канцелярия', name: 'Офис' }, ctx);
      expect(ren.undo).toEqual([{ method: 'PATCH', path: '/finance/categories/c-1', body: { name: 'Канцелярия' } }]);
      expect(categoryDelete.confirm!({ category: 'Канцелярия' }, ctx)).toBe(true);
      const pv = await categoryDelete.preview!({ category: 'Канцелярия' }, ctx);
      expect(pv.split('\n')[0]).toContain('УДАЛИТЬ СТАТЬЮ');
      expect((await categoryDelete.run({ category: 'Канцелярия' }, ctx)).undo).toBeUndefined();
    });
  });

  describe('инвентарь', () => {
    const asset = { id: 'a1', name: 'Sony A7', category: 'Техника', price: 25000, status: 'in_use', assignee: 'Бехруз', note: null, serviceMonths: 48 };

    it('изменение: в тело идут только изменённые поля DTO, undo — прежние значения', async () => {
      const api = fakeApi({ 'GET /finance/assets': () => [asset], 'PATCH /finance/assets/a1': () => asset });
      const ctx = ctxWith(api);
      const out = await assetUpdate.run({ asset: 'Sony', assignee: 'Завков', note: 'новая', service_months: 36 }, ctx);
      expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ assignee: 'Завков', note: 'новая', serviceMonths: 36 });
      expect(out.undo).toEqual([{ method: 'PATCH', path: '/finance/assets/a1', body: { assignee: 'Бехруз', note: null, serviceMonths: 48 } }]);
    });

    it('списание требует подтверждения, повтор того же — «менять нечего»', async () => {
      const ctx = ctxWith(fakeApi({ 'GET /finance/assets': () => [asset] }));
      expect(assetUpdate.confirm!({ asset: 'Sony', status: 'written_off' }, ctx)).toBe(true);
      expect(assetUpdate.confirm!({ asset: 'Sony', assignee: 'X' }, ctx)).toBe(false);
      const pv = await assetUpdate.preview!({ asset: 'Sony', status: 'written_off' }, ctx);
      expect(pv.split('\n')[0]).toContain('СПИСАТЬ');
      await expect(assetUpdate.preview!({ asset: 'Sony', status: 'in_use' }, ctx)).rejects.toThrow(/менять нечего/);
    });

    it('неверная дата и статус отклоняются до запроса', async () => {
      const api = fakeApi({ 'GET /finance/assets': () => [asset] });
      const ctx = ctxWith(api);
      await expect(assetUpdate.run({ asset: 'Sony', warranty_until: 'вчера' }, ctx)).rejects.toThrow(/Неверная/);
      await expect(assetUpdate.run({ asset: 'Sony', status: 'broken' }, ctx)).rejects.toThrow(/Статус/);
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
    });
  });

  describe('корректировки прогноза', () => {
    const adj = { id: 'j1', name: 'Покупка света', type: 'expense', amount: '5000.00', startYm: '2026-12', endYm: null, recurrence: 'once', scenario: 'all', note: null };

    it('изменение: undo возвращает прежние значения; конец раньше начала отклоняется', async () => {
      const api = fakeApi({ 'GET /finance/forecast/adjustments': () => [adj], 'PATCH /finance/forecast/adjustments/j1': () => adj });
      const ctx = ctxWith(api);
      await expect(forecastAdjustmentUpdate.run({ adjustment: 'света', end_month: '2026-01', recurrence: 'monthly' }, ctx)).rejects.toThrow(/Конец раньше/);
      const out = await forecastAdjustmentUpdate.run({ adjustment: 'света', amount: 7000, recurrence: 'monthly', end_month: '2027-03' }, ctx);
      expect(api.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ amount: 7000, recurrence: 'monthly', endYm: '2027-03' });
      expect(out.undo![0].body).toEqual({ amount: 5000, recurrence: 'once', endYm: null });
    });

    it('удаление с подтверждением; undo создаёт такую же корректировку', async () => {
      const api = fakeApi({ 'GET /finance/forecast/adjustments': () => [adj], 'DELETE /finance/forecast/adjustments/j1': () => ({ ok: true }) });
      const ctx = ctxWith(api);
      expect(forecastAdjustmentRemove.confirm!({ adjustment: 'света' }, ctx)).toBe(true);
      const out = await forecastAdjustmentRemove.run({ adjustment: 'света' }, ctx);
      expect(out.undo).toEqual([{
        method: 'POST', path: '/finance/forecast/adjustments',
        body: { name: 'Покупка света', type: 'expense', amount: 5000, startYm: '2026-12', recurrence: 'once', scenario: 'all' },
      }]);
    });
  });

  describe('зарплатный месяц', () => {
    const row = (over: Record<string, unknown>) => ({ id: 'e', name: 'Фарзона', salary: 3000, paid: 0, toPay: 0, frozen: false, ...over });
    const routes = (rows: any[], status = 'open') => ({
      'GET /finance/salary/period': () => ({ status, latestOpenYm: '2026-10', ym: '2026-10' }),
      'GET /finance/expense/detail/salary': () => ({ rows }),
      'POST /finance/salary/close-month': () => ({ ok: true, closed: rows.length }),
      'POST /finance/salary/reopen-month': () => ({ ok: true, reopened: rows.length }),
    });

    it('закрытие: нельзя, пока кому-то не выплачено — называет людей', async () => {
      const ctx = ctxWith(fakeApi(routes([row({ paid: 3000 }), row({ name: 'Амина', toPay: 1500 })])));
      const err = await salaryMonthClose.preview!({}, ctx).catch((e: Error) => e);
      expect(plain((err as Error).message)).toContain('Амина — 1 500 сом.');
    });

    it('закрытие: превью с числом людей и предупреждением, без undo', async () => {
      const api = fakeApi(routes([row({ paid: 3000 }), row({ name: 'Амина', paid: 1500, salary: 1500 })]));
      const ctx = ctxWith(api);
      expect(salaryMonthClose.confirm!({}, ctx)).toBe(true);
      const pv = plain(await salaryMonthClose.preview!({}, ctx));
      expect(pv.split('\n')[0]).toBe('🔒 ЗАКРЫТЬ ЗАРПЛАТНЫЙ МЕСЯЦ — ОКТЯБРЬ 2026');
      expect(pv).toContain('2 сотрудников');
      expect(pv).toContain('4 500 сом.');
      expect(pv).toContain('правки месяца недоступны');
      const out = await salaryMonthClose.run({}, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.body).toEqual({ ym: '2026-10' });
      expect(out.undo).toBeUndefined();
    });

    it('уже закрытый месяц не закрывается повторно, открытый не переоткрывается', async () => {
      await expect(salaryMonthClose.preview!({}, ctxWith(fakeApi(routes([row({ paid: 1, frozen: true })], 'closed'))))).rejects.toThrow(/уже закрыт/);
      await expect(salaryMonthReopen.preview!({}, ctxWith(fakeApi(routes([row({})]))))).rejects.toThrow(/и так открыт/);
    });

    it('переоткрытие: превью, вызов и неверный месяц', async () => {
      const api = fakeApi(routes([row({ frozen: true, paid: 3000 })], 'closed'));
      const ctx = ctxWith(api);
      const pv = await salaryMonthReopen.preview!({ month: '2026-10' }, ctx);
      expect(pv.split('\n')[0]).toContain('ПЕРЕОТКРЫТЬ ЗАРПЛАТНЫЙ МЕСЯЦ');
      await salaryMonthReopen.run({ month: '2026-10' }, ctx);
      expect(api.calls.find((c) => c.method === 'POST')!.path).toBe('/finance/salary/reopen-month');
      await expect(salaryMonthClose.preview!({ month: 'октябрь' }, ctx)).rejects.toThrow(/ГГГГ-ММ/);
    });
  });
});
