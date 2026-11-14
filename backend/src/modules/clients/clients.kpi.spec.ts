import { ClientsService } from './clients.service';

// KPI менеджера продаж на уровне сервиса (14.11.2026): встречи и письма —
// события lead_actions, норма — рабочие дни без отпуска, без «запасных»
// счётов по состоянию. База — заглушка: отвечаем по тексту запроса.

type Responder = (sql: string, params: any[]) => any;

function makeService(opts: { respond?: Responder; leads?: any[]; stateCount?: number } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const respond = opts.respond ?? (() => []);
  const manager = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return respond(sql, params);
    }),
  };
  const qb: any = {};
  for (const m of ['where', 'andWhere', 'leftJoinAndSelect', 'orderBy', 'limit']) qb[m] = jest.fn(() => qb);
  qb.getCount = jest.fn(async () => opts.stateCount ?? 0);
  const leads = [...(opts.leads ?? [])];
  const repo: any = {
    manager,
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => leads.shift()),
    update: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
  };
  const activityRepo: any = { manager, createQueryBuilder: jest.fn(() => qb) };
  const userRepo: any = { findOne: jest.fn(async () => ({ id: 'u1', role: 'sales_manager_smm' })) };
  const svc = new ClientsService(
    repo, { delete: jest.fn() } as any, activityRepo, userRepo, {} as any,
    { log: jest.fn() } as any, { broadcast: jest.fn() } as any, { create: jest.fn() } as any,
  );
  return { svc, calls };
}

const NOW = new Date('2026-11-14T10:00:00Z'); // суббота, 15:00 по Душанбе
const lead = (patch: any) => ({ id: 'L1', name: 'Кофейня', ownerId: 'u1', status: 'new', nextContactAt: null, emailStatus: null, ...patch });

beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('встречи — события при переносе', () => {
  const future = new Date('2026-11-16T09:00:00Z');
  const later = new Date('2026-11-20T09:00:00Z');
  const past = new Date('2026-11-13T09:00:00Z');

  it('будущую встречу перенесли: её запись удаляется, новая пишется владельцу', async () => {
    const before = lead({ nextContactAt: future });
    const after = lead({ nextContactAt: later });
    const { svc, calls } = makeService({ leads: [before, after, after] });
    await svc.update('L1', { nextContactAt: later } as any, 'u1');
    const del = calls.find(c => c.sql.startsWith('DELETE FROM lead_actions'));
    expect(del?.params).toEqual(['L1', NOW]);
    const ins = calls.find(c => c.sql.includes('INSERT INTO lead_actions') && c.sql.includes('meeting'));
    expect(ins?.params).toEqual(['u1', 'L1', later]);
  });

  it('прошедшая встреча остаётся: удаления нет, новая пишется', async () => {
    const { svc, calls } = makeService({ leads: [lead({ nextContactAt: past }), lead({ nextContactAt: later }), lead({})] });
    await svc.update('L1', { nextContactAt: later } as any, 'u1');
    expect(calls.some(c => c.sql.startsWith('DELETE FROM lead_actions'))).toBe(false);
    expect(calls.some(c => c.sql.includes('INSERT INTO lead_actions') && c.sql.includes('meeting'))).toBe(true);
  });

  it('правка лида без смены встречи журнал не трогает; «Написал» — одно письмо', async () => {
    const { svc, calls } = makeService({
      leads: [lead({ nextContactAt: future }), lead({ nextContactAt: future, emailStatus: 'sent' }), lead({})],
    });
    await svc.update('L1', { emailStatus: 'sent' } as any, 'u1');
    const touched = calls.filter(c => c.sql.includes('lead_actions'));
    expect(touched).toHaveLength(1);
    expect(touched[0].sql).toContain('email');
    expect(touched[0].params).toEqual(['u1', 'L1']);
  });
});

describe('kpi() — нормы по рабочим дням и события', () => {
  const respond = (counts: Record<string, number>, extra: Responder = () => undefined): Responder => (sql, params) => {
    const r = extra(sql, params);
    if (r !== undefined) return r;
    if (sql.includes('FROM shift_absences')) return [{ day: '2026-11-12' }];
    if (sql.includes('FROM lead_actions')) return [{ c: counts[params[1]] ?? 0 }];
    if (sql.includes('FROM lead_progress')) return [{ s: counts.progress ?? 0 }];
    return [];
  };

  it('неделя до сегодня: 6 рабочих дней минус отгул = 5; будущее не считаем', async () => {
    const { svc, calls } = makeService({ respond: respond({ meeting: 3, email: 4, cold_call: 0, progress: 5 }), stateCount: 7 });
    const k = await svc.kpi('u1', undefined, '2026-11-09', '2026-11-15');
    expect(k.workDays).toBe(5);
    expect(k.restDay).toBe(false);
    const by = Object.fromEntries(k.items.map(i => [i.key, i]));
    expect(by.meetings).toMatchObject({ value: 3, target: 10 });
    expect(by.personal_emails).toMatchObject({ value: 4, target: 50 });
    expect(by.funnel_progress).toMatchObject({ value: 5, target: 100 });
    expect(by.new_companies).toMatchObject({ value: 7, target: 75 });
    // Событий холодных звонков нет — ноль, а не счёт по состоянию лидов.
    expect(by.cold_calls).toMatchObject({ value: 0, target: 100 });
    // Встречи — до «сейчас», не до конца воскресенья.
    const meet = calls.find(c => c.sql.includes('FROM lead_actions') && c.params[1] === 'meeting')!;
    expect(meet.sql).toContain('"at" BETWEEN');
    expect(meet.params[2].toISOString()).toBe('2026-11-08T19:00:00.000Z');
    expect(meet.params[3]).toEqual(NOW);
  });

  it('период до 16.06.2026 — холодные звонки по старому счёту', async () => {
    const { svc } = makeService({ respond: respond({ cold_call: 0 }), stateCount: 7 });
    const k = await svc.kpi('u1', undefined, '2026-05-01', '2026-05-31');
    expect(k.items.find(i => i.key === 'cold_calls')!.value).toBe(7);
  });

  it('воронка: ноль в lead_progress — ноль; activity_logs — только если запрос упал', async () => {
    const zero = makeService({ respond: respond({ progress: 0 }), stateCount: 7 });
    expect((await zero.svc.kpi('u1', undefined, '2026-11-09', '2026-11-14')).items[0].value).toBe(0);
    const broken = makeService({
      respond: respond({}, sql => { if (sql.includes('FROM lead_progress')) throw new Error('нет таблицы'); return undefined; }),
      stateCount: 7,
    });
    expect((await broken.svc.kpi('u1', undefined, '2026-11-09', '2026-11-14')).items[0].value).toBe(7);
  });

  it('сегодня воскресенье — выходной: нормы 0, процента нет', async () => {
    jest.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const { svc } = makeService({ respond: respond({ cold_call: 4 }) });
    const k = await svc.kpi('u1');
    expect(k.restDay).toBe(true);
    expect(k.overallPercent).toBe(0);
    expect(k.items.every(i => i.target === 0 && !i.done)).toBe(true);
    expect(k.items.find(i => i.key === 'cold_calls')!.value).toBe(4);
  });

  it('весь период в отпуске — выходной', async () => {
    const { svc } = makeService({
      respond: respond({}, sql => (sql.includes('FROM employee_vacations')
        ? [{ from: '2026-11-01', until: '2026-11-30' }] : undefined)),
    });
    const k = await svc.kpi('u1', undefined, '2026-11-09', '2026-11-14');
    expect(k.restDay).toBe(true);
    expect(k.workDays).toBe(0);
  });
});
