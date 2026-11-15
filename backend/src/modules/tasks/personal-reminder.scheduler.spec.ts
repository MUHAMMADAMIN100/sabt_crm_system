import { PersonalReminderScheduler } from './personal-reminder.scheduler';
import { TaskKind, TaskStatus } from './task.entity';
import { ClientLeadStatus } from '../clients/client-lead.entity';

/** Напоминания: встречи и повторные звонки по лидам рядом с задачами. */

const lead = (over: Record<string, any>) => ({
  id: 'L1', name: 'Кафе «Сафо»', ownerId: 'SM', status: ClientLeadStatus.NEGOTIATING,
  nextContactAt: null, repeatCallAt: null, meetingTaskId: null, ...over,
}) as any;

function setup(opts: { tasks?: any[]; leads?: any[]; liveTaskIds?: string[]; due?: any[]; stale?: any[] } = {}) {
  const state = { leads: opts.leads || [] };
  const taskRepo = {
    // select — запрос живых задач-двойников; иначе — записи календаря.
    find: jest.fn(async (q: any) => (q?.select
      ? (opts.liveTaskIds || []).map(id => ({ id }))
      : opts.tasks || [])),
  };
  // Сырые запросы «Продажи, этап 2»: дела по лидам и лиды без касания.
  const leadSql = jest.fn(async (sql: string, _params?: any[]) => {
    if (sql.includes('"lastActivityAt", cl."createdAt"')) return opts.stale || [];
    if (sql.includes('UNION ALL')) return opts.due || [];
    return [];
  });
  const leadRepo = { find: jest.fn(async () => state.leads), manager: { query: leadSql } };
  const tasks = {
    publicTaskButtons: jest.fn(() => [[{ text: 'ok', callback_data: 'x' }]]),
    calendarEntryMessage: jest.fn((t: any) => `task ${t.title}`),
  };
  const notifications = { create: jest.fn(async (n: any) => n) };
  const telegram = { appUrl: 'https://crm.test', sendToUser: jest.fn(async () => undefined) };
  const s = new PersonalReminderScheduler(taskRepo as any, tasks as any, notifications as any, telegram as any, leadRepo as any);
  return { s, state, taskRepo, leadRepo, leadSql, notifications, telegram };
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

describe('PersonalReminderScheduler — дела по лидам менеджера продаж (15.11.2026)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  const due = (i: number, kind: string, at: string, over: Record<string, any> = {}) =>
    ({ id: `L${i}`, name: `Клиент ${i}`, owner: 'SM', kind, at: new Date(at), note: null, ...over });

  describe('утро 09:00', () => {
    beforeEach(() => jest.setSystemTime(new Date('2026-11-14T04:00:00Z'))); // 09:00 Душанбе

    it('просроченное по своим лидам и «без касания» — даже без плана на день', async () => {
      const { s, telegram, notifications, leadSql } = setup({
        due: [
          due(1, 'meeting', '2026-11-12T10:00:00Z'),
          due(2, 'callback', '2026-11-13T06:00:00Z'),
          due(3, 'next_step', '2026-11-14T03:00:00Z', { note: 'Отправить <КП>' }),
        ],
        stale: [{ owner: 'SM', n: 4 }],
      });
      await s.morningAgenda();

      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
      const [userId, text] = telegram.sendToUser.mock.calls[0] as any[];
      expect(userId).toBe('SM');
      expect(text).toContain('Просрочено по клиентам: 3');
      expect(text).toContain('🤝 <b>12.11 15:00</b> — Встреча без итога: Клиент 1');
      expect(text).toContain('📞 <b>13.11 11:00</b> — Перезвонить: Клиент 2');
      expect(text).toContain('➡️ <b>14.11 08:00</b> — Шаг: Клиент 3 — Отправить &lt;КП&gt;');
      expect(text).toContain('Без касания 7+ дней: <b>4</b>');
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'SM', message: 'Просрочено по клиентам: 3 · Без касания 7+ дн.: 4', link: '/clients',
      }));
      // Встречи и перезвоны — до начала сегодняшнего дня (сегодняшние уже в плане),
      // шаги — до этой минуты; только активные этапы.
      const [, params] = leadSql.mock.calls.find(c => String(c[0]).includes('UNION ALL')) as any[];
      expect(params[0]).toEqual(['sales_manager_smm', 'sales_manager_dev']);
      expect(params[2]).toEqual(new Date('2026-11-13T19:00:00Z'));
      expect(params[4]).toEqual(new Date('2026-11-14T04:00:00Z'));
      expect(params[5]).toBe(false);
      expect(params[6]).toEqual(['new', 'waiting', 'meeting', 'proposal', 'contract']);
    });

    it('больше 10 просрочек — первые 10 и «…и ещё N»', async () => {
      const many = Array.from({ length: 13 }, (_, i) => due(i + 1, 'callback', `2026-11-0${(i % 9) + 1}T06:00:00Z`));
      const { s, telegram } = setup({ due: many });
      await s.morningAgenda();
      const text = (telegram.sendToUser.mock.calls[0] as any[])[1] as string;
      expect(text.match(/Перезвонить:/g)).toHaveLength(10);
      expect(text).toContain('…и ещё 3');
    });

    it('план дня и просрочки — одним сообщением', async () => {
      const { s, telegram } = setup({
        leads: [lead({ nextContactAt: new Date('2026-11-14T10:00:00Z') })],
        due: [due(5, 'meeting', '2026-11-10T10:00:00Z')],
      });
      await s.morningAgenda();
      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
      const text = (telegram.sendToUser.mock.calls[0] as any[])[1] as string;
      expect(text).toContain('Встреч: 1 · Просрочено по клиентам: 1');
      expect(text.indexOf('Встреча: Кафе «Сафо»')).toBeLessThan(text.indexOf('Встреча без итога: Клиент 5'));
    });
  });

  describe('вечер 18:00', () => {
    beforeEach(() => jest.setSystemTime(new Date('2026-11-14T13:00:00Z'))); // 18:00 Душанбе

    it('невыполненное за сегодня по лидам — вместе с задачами', async () => {
      const { s, telegram, notifications, leadSql } = setup({
        tasks: [{ id: 'T1', title: 'Отчёт', assigneeId: 'SM', kind: TaskKind.TASK, status: TaskStatus.NEW, deadline: new Date('2026-11-14T12:00:00Z') }],
        due: [due(1, 'meeting', '2026-11-14T06:00:00Z'), due(2, 'next_step', '2026-11-14T09:30:00Z', { note: 'КП' })],
      });
      await s.eveningUnfinished();

      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'SM', message: 'Осталось 3' }));
      const text = (telegram.sendToUser.mock.calls[0] as any[])[1] as string;
      expect(text).toContain('📌 Отчёт');
      expect(text).toContain('По клиентам: 2');
      expect(text).toContain('🤝 <b>11:00</b> — Встреча без итога: Клиент 1');
      expect(text).toContain('➡️ <b>14:30</b> — Шаг: Клиент 2 — КП');
      // Окно — сегодня до этой минуты, и только нетронутое после своего времени.
      const [, params] = leadSql.mock.calls.find(c => String(c[0]).includes('UNION ALL')) as any[];
      expect(params[1]).toEqual(new Date('2026-11-13T19:00:00Z'));
      expect(params[2]).toEqual(new Date('2026-11-14T13:00:00Z'));
      expect(params[5]).toBe(true);
    });

    it('одна задача без дел по лидам — как раньше, с кнопками', async () => {
      const { s, telegram } = setup({
        tasks: [{ id: 'T1', title: 'Отчёт', assigneeId: 'U1', kind: TaskKind.TASK, status: TaskStatus.NEW, deadline: new Date('2026-11-14T12:00:00Z') }],
      });
      await s.eveningUnfinished();
      const [, text, buttons] = telegram.sendToUser.mock.calls[0] as any[];
      expect(text).toBe('task Отчёт');
      expect(buttons).toBeDefined();
    });

    it('сбой запроса по лидам не глушит задачи', async () => {
      const { s, telegram, leadSql } = setup({
        tasks: [{ id: 'T1', title: 'Отчёт', assigneeId: 'U1', kind: TaskKind.TASK, status: TaskStatus.NEW, deadline: new Date('2026-11-14T12:00:00Z') }],
      });
      leadSql.mockRejectedValue(new Error('db down'));
      await s.eveningUnfinished();
      expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
    });
  });
});
