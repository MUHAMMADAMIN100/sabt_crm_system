import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { DeadlineScheduler, LEGACY_TASK_NOTIFICATIONS_SQL } from './deadline.scheduler';
import { RiskAlertsScheduler } from '../risk-analytics/risk-alerts.scheduler';

/** Кроны по расписанию: имя метода → опции @Cron. */
function crons(cls: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    const fn = cls.prototype[name];
    const meta = typeof fn === 'function' ? Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, fn) : undefined;
    if (meta) out[name] = meta;
  }
  return out;
}

describe('DeadlineScheduler: старт и расписание', () => {
  it('на старте не стирает обычные уведомления по задачам', async () => {
    const query = jest.fn(async () => [[], 0]);
    const s = new DeadlineScheduler({ manager: { query } } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await s.onModuleInit();

    const sqls = query.mock.calls.map((c: any[]) => String(c[0]).replace(/\s+/g, ' ').trim());
    expect(sqls.length).toBe(2);
    // Голой чистки по link больше нет.
    expect(sqls.some(q => /^DELETE FROM notifications WHERE link LIKE '\/tasks%'$/.test(q))).toBe(false);
    for (const q of sqls) {
      expect(q).toMatch(/^DELETE FROM notifications/);
      // Каждая чистка — либо осиротевшие (задачи нет), либо хвосты старых кронов до 28.06.2026.
      const orphan = q.includes('NOT EXISTS') && q.includes('FROM tasks t');
      const legacy = q.includes("type::text IN") && q.includes(`"createdAt" < '2026-06-28'`);
      expect(orphan || legacy).toBe(true);
    }
  });

  it('хвосты: только типы отключённых кронов, без комментариев и задач от руководителя', () => {
    const types = /type::text IN \(([^)]*)\)/.exec(LEGACY_TASK_NOTIFICATIONS_SQL)![1]
      .split(',').map(s => s.trim().replace(/'/g, ''));
    expect(types.sort()).toEqual(['daily_uncompleted', 'deadline_approaching', 'deadline_tomorrow', 'review_needed', 'task_overdue']);
    // Голосовые «срок прошёл» (task_overdue, /tasks/:id) появились с 05.08.2026 —
    // дата их не берёт, дедуп по ним жив.
    expect(LEGACY_TASK_NOTIFICATIONS_SQL).toContain(`"createdAt" < '2026-06-28'`);
  });

  it('напоминаний об оплате по старым полям проекта в расписании нет', () => {
    const names = Object.keys(crons(DeadlineScheduler));
    expect(names).not.toContain('notifyPaymentReminder');
    expect(names).not.toContain('notifyNextPaymentDate');
    expect((DeadlineScheduler.prototype as any).notifyPaymentReminder).toBeUndefined();
    expect((DeadlineScheduler.prototype as any).notifyNextPaymentDate).toBeUndefined();
  });

  it('утренние кроны (9 часов) — по Душанбе, а не по UTC сервера', () => {
    const all = { ...crons(DeadlineScheduler), ...crons(RiskAlertsScheduler) };
    const morning = Object.entries(all).filter(([, o]) => {
      const hour = String(o.cronTime).trim().split(/\s+/).slice(-4)[0];
      return /^0?9$/.test(hour);
    });
    expect(morning.length).toBeGreaterThan(0);
    for (const [name, o] of morning) expect([name, o.timeZone]).toEqual([name, 'Asia/Dushanbe']);
  });
});
