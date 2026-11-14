import { BotWorkspaceService } from './bot-workspace.service';
import { ClientLeadStatus } from '../clients/client-lead.entity';

/** /today в Telegram: встречи и повторные звонки по своим лидам. */

const lead = (over: Record<string, any>) => ({
  id: 'L1', name: 'Кафе «Сафо»', ownerId: 'SM', status: ClientLeadStatus.NEGOTIATING,
  nextContactAt: null, repeatCallAt: null, meetingTaskId: null, ...over,
}) as any;

function setup(leads: any[], tasks: any[] = []) {
  const qb: any = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take']) qb[m] = jest.fn(() => qb);
  qb.getMany = jest.fn(async () => tasks);
  const taskRepo = { createQueryBuilder: jest.fn(() => qb), find: jest.fn(async () => []) };
  const assigneeRepo = { find: jest.fn(async () => []) };
  const userRepo = { findOne: jest.fn(async () => ({ id: 'SM', role: 'sales_manager_smm', isActive: true, isBlocked: false })) };
  const leadRepo = { find: jest.fn(async () => leads) };
  const telegram = {
    appUrl: 'https://crm.test',
    resolveUserIdByChat: jest.fn(async () => 'SM'),
    sendMessage: jest.fn(async () => undefined),
  };
  const s = new BotWorkspaceService(
    taskRepo as any, assigneeRepo as any, userRepo as any, {} as any, {} as any, {} as any, telegram as any, leadRepo as any,
  );
  return { s, telegram, leadRepo };
}

describe('BotWorkspaceService — /today', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-11-14T06:00:00Z')); // 11:00 Душанбе
  });
  afterEach(() => jest.useRealTimers());

  it('без задач, но со встречей и звонком — показывает клиентов, а не «задач нет»', async () => {
    const { s, telegram, leadRepo } = setup([
      lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') }),
      lead({ id: 'L2', name: 'Школа «Ilm»', repeatCallAt: new Date('2026-11-14T10:30:00Z') }),
      lead({ id: 'L3', name: 'Отказ', status: ClientLeadStatus.LOST, nextContactAt: new Date('2026-11-14T11:00:00Z') }),
    ]);
    expect(await s.sendList(42, true)).toBe(true);

    const texts = telegram.sendMessage.mock.calls.map((c: any[]) => c[1] as string);
    expect(texts[0]).toBe('📅 <b>Сегодня: 2</b>');
    expect(texts[1]).toContain('🤝 Встреча: Кафе «Сафо» — 15:00');
    expect(texts[1]).toContain('📞 Перезвонить: Школа «Ilm» — 15:30');
    expect(texts[1]).not.toContain('Отказ');
    expect(texts.join('\n')).not.toContain('задач и встреч нет');
    // Только свои лиды.
    for (const w of (leadRepo.find.mock.calls[0] as any[])[0].where) expect(w.ownerId).toBe('SM');
  });

  it('ни задач, ни клиентов — прежний ответ', async () => {
    const { s, telegram } = setup([]);
    await s.sendList(42, true);
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, '📅 На сегодня задач и встреч нет.');
  });

  it('/tasks (не «сегодня») лиды не читает', async () => {
    const { s, leadRepo, telegram } = setup([lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') })]);
    await s.sendList(42, false);
    expect(leadRepo.find).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, '✅ Открытых задач нет.');
  });
});
