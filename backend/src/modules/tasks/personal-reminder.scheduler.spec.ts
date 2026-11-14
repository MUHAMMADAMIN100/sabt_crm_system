import { PersonalReminderScheduler } from './personal-reminder.scheduler';
import { TaskKind, TaskStatus } from './task.entity';
import { ClientLeadStatus } from '../clients/client-lead.entity';

/** Напоминания: встречи и повторные звонки по лидам рядом с задачами. */

const lead = (over: Record<string, any>) => ({
  id: 'L1', name: 'Кафе «Сафо»', ownerId: 'SM', status: ClientLeadStatus.NEGOTIATING,
  nextContactAt: null, repeatCallAt: null, meetingTaskId: null, ...over,
}) as any;

function setup(opts: { tasks?: any[]; leads?: any[]; liveTaskIds?: string[] } = {}) {
  const state = { leads: opts.leads || [] };
  const taskRepo = {
    // select — запрос живых задач-двойников; иначе — записи календаря.
    find: jest.fn(async (q: any) => (q?.select
      ? (opts.liveTaskIds || []).map(id => ({ id }))
      : opts.tasks || [])),
  };
  const leadRepo = { find: jest.fn(async () => state.leads) };
  const tasks = {
    publicTaskButtons: jest.fn(() => [[{ text: 'ok', callback_data: 'x' }]]),
    calendarEntryMessage: jest.fn((t: any) => `task ${t.title}`),
  };
  const notifications = { create: jest.fn(async (n: any) => n) };
  const telegram = { appUrl: 'https://crm.test', sendToUser: jest.fn(async () => undefined) };
  const s = new PersonalReminderScheduler(taskRepo as any, tasks as any, notifications as any, telegram as any, leadRepo as any);
  return { s, state, taskRepo, leadRepo, notifications, telegram };
}

describe('PersonalReminderScheduler — клиенты в напоминаниях', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  describe('утренний план 09:00', () => {
    beforeEach(() => jest.setSystemTime(new Date('2026-11-14T04:00:00Z'))); // 09:00 Душанбе

    it('встреча и повторный звонок по своим лидам — в плане, по времени; lost и завтрашние — нет', async () => {
      const { s, telegram, notifications } = setup({
        leads: [
          lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') }),
          lead({ id: 'L2', name: 'Школа «Ilm»', repeatCallAt: new Date('2026-11-14T10:30:00Z') }),
          lead({ id: 'L3', name: 'Отказник', status: ClientLeadStatus.LOST, nextContactAt: new Date('2026-11-14T11:00:00Z') }),
          lead({ id: 'L4', name: 'Завтра', nextContactAt: new Date('2026-11-15T05:00:00Z') }),
        ],
      });
      await s.morningAgenda();

      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
      const [userId, text] = telegram.sendToUser.mock.calls[0] as any[];
      expect(userId).toBe('SM');
      expect(text).toContain('Встреч: 1 · Звонков: 1');
      const meet = text.indexOf('🤝 <b>15:00</b> — Встреча: Кафе «Сафо»');
      const call = text.indexOf('📞 <b>15:30</b> — Перезвонить: Школа «Ilm»');
      expect(meet).toBeGreaterThan(0);
      expect(call).toBeGreaterThan(meet);
      expect(text).not.toContain('Отказник');
      expect(text).not.toContain('Завтра');
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'SM', message: 'Встреч: 1 · Звонков: 1' }));
    });

    it('задачи и клиенты одного человека — одним сообщением; двойник встречи не дублируется', async () => {
      const { s, telegram } = setup({
        tasks: [
          { id: 'T1', title: 'Встреча: Бахор', assigneeId: 'PM', kind: TaskKind.MEETING, status: TaskStatus.NEW, deadline: new Date('2026-11-14T07:00:00Z') },
          { id: 'T2', title: 'Отчёт', assigneeId: 'PM', kind: TaskKind.TASK, status: TaskStatus.NEW, deadline: new Date('2026-11-14T12:00:00Z') },
        ],
        leads: [
          // Владелец не МП: у встречи есть задача T1 — напомнит она.
          lead({ id: 'L9', name: 'Бахор', ownerId: 'PM', meetingTaskId: 'T1', nextContactAt: new Date('2026-11-14T07:00:00Z') }),
          lead({ id: 'L8', name: 'Нур', ownerId: 'PM', repeatCallAt: new Date('2026-11-14T09:00:00Z') }),
        ],
        liveTaskIds: ['T1'],
      });
      await s.morningAgenda();

      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
      const text = (telegram.sendToUser.mock.calls[0] as any[])[1] as string;
      expect(text).toContain('Задач: 1 · Встреч: 1 · Звонков: 1');
      expect(text.match(/Бахор/g)).toHaveLength(1);
      expect(text.indexOf('Перезвонить: Нур')).toBeLessThan(text.indexOf('Отчёт'));
    });

    it('нет ни задач, ни клиентов — тишина', async () => {
      const { s, telegram, notifications } = setup();
      await s.morningAgenda();
      expect(telegram.sendToUser).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('сбой запроса по лидам не глушит задачи', async () => {
      const { s, leadRepo, telegram } = setup({
        tasks: [{ id: 'T2', title: 'Отчёт', assigneeId: 'PM', kind: TaskKind.TASK, status: TaskStatus.NEW, deadline: new Date('2026-11-14T12:00:00Z') }],
      });
      leadRepo.find.mockRejectedValueOnce(new Error('db down'));
      await s.morningAgenda();
      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('«через час»', () => {
    beforeEach(() => jest.setSystemTime(new Date('2026-11-14T09:00:00Z'))); // 14:00 Душанбе

    it('встреча в 15:00 — одно напоминание со ссылкой на клиента, повтор крона не шлёт', async () => {
      const { s, state, notifications, telegram } = setup({
        leads: [
          lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') }),
          lead({ id: 'L2', name: 'Школа «Ilm»', repeatCallAt: new Date('2026-11-14T10:30:00Z') }),
        ],
      });
      await s.hourBefore();

      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'SM',
        title: '⏰ Встреча через час',
        message: 'Встреча: Кафе «Сафо» — 15:00',
        link: '/clients?id=L1',
      }));
      const [, text, buttons] = telegram.sendToUser.mock.calls[0] as any[];
      expect(text).toContain('Встреча: Кафе «Сафо» — 15:00');
      expect(text).toContain('https://crm.test/clients?id=L1');
      expect(buttons).toBeUndefined();

      // Следующий прогон через 5 минут: встреча ещё в окне — дедуп.
      jest.setSystemTime(new Date('2026-11-14T09:05:00Z'));
      await s.hourBefore();
      expect(notifications.create).toHaveBeenCalledTimes(1);

      // Встречу перенесли на 15:05 — это новое время, напоминаем снова.
      state.leads = [lead({ nextContactAt: new Date('2026-11-14T10:05:00Z') })];
      await s.hourBefore();
      expect(notifications.create).toHaveBeenCalledTimes(2);
    });

    it('повторный звонок — «Звонок через час» и «Перезвонить: …»', async () => {
      jest.setSystemTime(new Date('2026-11-14T09:30:00Z'));
      const { s, notifications } = setup({
        leads: [lead({ id: 'L2', name: 'Школа «Ilm»', repeatCallAt: new Date('2026-11-14T10:30:00Z') })],
      });
      await s.hourBefore();
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        title: '⏰ Звонок через час',
        message: 'Перезвонить: Школа «Ilm» — 15:30',
        link: '/clients?id=L2',
      }));
    });

    it('задачи «через час» работают как раньше — ссылка на задачу и кнопки', async () => {
      const { s, notifications, telegram } = setup({
        tasks: [{ id: 'T5', title: 'Созвон', assigneeId: 'U5', kind: TaskKind.MEETING, status: TaskStatus.NEW, deadline: new Date('2026-11-14T10:00:00Z') }],
      });
      await s.hourBefore();
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'U5', link: '/tasks/T5' }));
      expect((telegram.sendToUser.mock.calls[0] as any[])[2]).toBeDefined();
    });
  });
});
