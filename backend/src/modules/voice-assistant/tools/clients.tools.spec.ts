import { RefTable } from '../refs';
import { ToolContext } from './types';
import { unpaidClients } from './clients.tools';

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  return {
    user: { id: 'U1', name: 'Тест', role: 'sales_manager_smm', secondaryRole: null, extraPermissions: [], deniedPermissions: [], ...user } as any,
    api,
    refs: new RefTable(),
    today: '2026-11-10',
    nowTime: '10:00',
    utterance: '',
  };
}

describe('unpaid_clients', () => {
  it('даты оплат берёт из поля date календаря (раньше ответы были без дат)', async () => {
    const api = {
      get: jest.fn(async () => ({
        items: [
          { name: 'Сафо', date: '2026-11-08', state: 'late', partNo: 1, amount: 1500 },
          { name: 'Ilm', date: '2026-11-10', state: 'today', partNo: 2, amount: 0 },
          { name: 'Бахор', date: '2026-11-15', state: 'wait', partNo: 1, amount: 900 },
        ],
      })),
    };
    const out = await unpaidClients.run({ include_upcoming_days: 7 }, ctxWith(api));
    expect(api.get).toHaveBeenCalledWith('/smm-payments/calendar', { from: '2026-11-10', to: '2026-11-17' });
    expect(out.late).toEqual([{ name: 'Сафо', due: '8 ноября', part: undefined, amount: 1500 }]);
    expect(out.today).toEqual([{ name: 'Ilm', due: '10 ноября', part: 2 }]);
    expect(out.upcoming).toEqual([{ name: 'Бахор', due: '15 ноября', part: undefined, amount: 900 }]);
  });
});
