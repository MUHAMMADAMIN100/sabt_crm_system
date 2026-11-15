import { RefTable } from '../refs';
import { ApiError } from '../internal-api';
import { ToolContext, ToolError } from './types';
import { createLead, findClients, LEAD_STATUS_RU, unpaidClients, updateClient } from './clients.tools';

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

// Единая воронка и дубли (15.11.2026, docs/SALES_SPEC.md).
describe('create_lead — дубли', () => {
  const dup = new ApiError(409, 'duplicate', {
    message: 'duplicate',
    duplicates: [
      { id: 'L2', name: 'Кофейня «Сафо»', status: 'waiting', ownerName: 'Мадина' },
      { id: 'L3', name: 'Сафо', status: 'lost', ownerName: null },
    ],
  });

  it('сервер нашёл похожие — называем их и не создаём молча', async () => {
    const api = { post: jest.fn(async () => { throw dup; }) };
    const err = await createLead.run({ name: 'Сафо', phone: '900112233' }, ctxWith(api)).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.message).toContain('«Кофейня «Сафо»» (Контакт, ведёт Мадина)');
    expect(err.message).toContain('«Сафо» (Проиграно, без владельца)');
    expect(err.message).toContain('force=true');
    expect((api.post.mock.calls[0] as any[])[1]).not.toHaveProperty('force');
  });

  it('человек подтвердил — force: true уходит в запрос', async () => {
    const api = { post: jest.fn(async () => ({ id: 'L9' })) };
    const out = await createLead.run({ name: 'Сафо', force: true }, ctxWith(api));
    expect((api.post.mock.calls[0] as any[])[1]).toMatchObject({ name: 'Сафо', force: true, ownerId: 'U1' });
    expect(out.summary).toContain('Лид «Сафо» создан');
  });

  it('другая ошибка сервера — как раньше', async () => {
    const api = { post: jest.fn(async () => { throw new ApiError(400, 'Неизвестный этап воронки'); }) };
    await expect(createLead.run({ name: 'X' }, ctxWith(api))).rejects.toThrow('Неизвестный этап воронки');
  });
});

describe('этапы воронки в голосе', () => {
  it('ставить можно только этапы единой воронки, подписи — новые', () => {
    expect(findClients.parameters.properties.status.enum).toEqual(['new', 'waiting', 'meeting', 'proposal', 'contract', 'won', 'lost']);
    expect(updateClient.parameters.properties.status.enum).not.toContain('negotiating');
    expect(updateClient.parameters.properties).not.toHaveProperty('stage');
    expect(LEAD_STATUS_RU.proposal).toBe('КП');
    expect(LEAD_STATUS_RU.negotiating).toBe('Контакт');
  });

  it('«клиент отказался» без причины — спрашиваем причину, на сервер не идём', async () => {
    const api = { get: jest.fn(async () => ({ id: 'L1', name: 'Сафо', status: 'waiting' })), patch: jest.fn() };
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('C', 'L1', 'Сафо');
    await expect(updateClient.run({ client: ref, status: 'lost' }, ctx)).rejects.toThrow('Укажите причину проигрыша');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('проигрыш с причиной и пауза; отмена возвращает и прежнюю причину', async () => {
    const api = {
      get: jest.fn(async () => ({ id: 'L1', name: 'Сафо', status: 'lost', lostReason: 'price', rejectionReason: null, onHold: false })),
      patch: jest.fn(async () => ({})),
    };
    const ctx = ctxWith(api);
    const ref = ctx.refs.add('C', 'L1', 'Сафо');
    const out = await updateClient.run({ client: ref, status: 'waiting', on_hold: true }, ctx);
    expect(api.patch).toHaveBeenCalledWith('/clients/L1', { status: 'waiting', onHold: true });
    expect(out.undo?.[0].body).toEqual({ status: 'lost', onHold: false, lostReason: 'price', rejectionReason: null });

    const api2 = { get: jest.fn(async () => ({ id: 'L1', name: 'Сафо', status: 'waiting' })), patch: jest.fn(async () => ({})) };
    const ctx2 = ctxWith(api2);
    const ref2 = ctx2.refs.add('C', 'L1', 'Сафо');
    await updateClient.run({ client: ref2, status: 'lost', lost_reason: 'competitor' }, ctx2);
    expect(api2.patch).toHaveBeenCalledWith('/clients/L1', { status: 'lost', lostReason: 'competitor' });
  });
});
