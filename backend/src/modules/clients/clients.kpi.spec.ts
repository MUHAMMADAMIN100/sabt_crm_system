import { ClientsService } from './clients.service';

// KPI менеджера продаж на уровне сервиса (14.11.2026): письма — события
// lead_actions, норма — рабочие дни без отпуска, без «запасных» счётов по
// состоянию. С 15.11.2026: встречи — только «состоялась» (пишет
// SalesService), нормы — из настроек продаж, вехи воронки — по этапу.
// База — заглушка: отвечаем по тексту запроса.

type Responder = (sql: string, params: any[]) => any;
type Call = { sql: string; params: any[] };

const L1 = '0b0b0b0b-0000-4000-8000-000000000001';

function makeService(opts: { respond?: Responder; leads?: any[]; stateCount?: number } = {}) {
  const calls: Call[] = [];
  const respond = opts.respond ?? (() => []);
  const manager = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return respond(sql, params);
    }),
  };
  // Очередь «как лид лежит в базе»: до правки, после правки; дальше — последний.
  const queue = [...(opts.leads ?? [])];
  let last: any = null;
  const qb: any = {};
  for (const m of ['where', 'andWhere', 'leftJoin', 'leftJoinAndSelect', 'addSelect', 'orderBy', 'addOrderBy', 'limit', 'offset']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getCount = jest.fn(async () => opts.stateCount ?? 0);
  qb.getOne = jest.fn(async () => (last ? { ...last } : null));
  const repo: any = {
    manager,
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => {
      const l = queue.length ? queue.shift() : last;
      last = l;
      return l ? { ...l } : null;
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    create: jest.fn((x: any) => ({ id: L1, ...x })),
    save: jest.fn(async (x: any) => { last = x; return x; }),
    query: jest.fn(async () => []),
  };
  const activityRepo: any = { manager, createQueryBuilder: jest.fn(() => qb) };
  const userRepo: any = {
    findOne: jest.fn(async () => ({ id: 'u1', role: 'sales_manager_smm' })),
    find: jest.fn(async () => []),
  };
  const svc = new ClientsService(
    repo, { delete: jest.fn() } as any, activityRepo, userRepo, {} as any,
    { log: jest.fn() } as any, { broadcast: jest.fn() } as any, { create: jest.fn() } as any,
  );
  return { svc, calls, repo };
}

const NOW = new Date('2026-11-14T10:00:00Z'); // суббота, 15:00 по Душанбе
const lead = (patch: any) => ({
  id: L1, name: 'Кофейня', ownerId: 'u1', status: 'new', direction: 'smm',
  nextContactAt: null, emailStatus: null, meetingResult: null, onHold: false, ...patch,
});
const smm = { id: 'u1', role: 'sales_manager_smm', name: 'Алишер' };

beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('встречи — назначение больше не пишет KPI (15.11.2026)', () => {
  const future = new Date('2026-11-16T09:00:00Z');
  const later = new Date('2026-11-20T09:00:00Z');

  it('перенос встречи: lead_actions не трогаем, итог прежней встречи сбрасываем, в ленту — meeting_set', async () => {
    const before = lead({ nextContactAt: future, meetingResult: 'missed' });
    const after = lead({ nextContactAt: later });
    const { svc, calls, repo } = makeService({ leads: [before, after] });
    await svc.update(L1, { nextContactAt: later } as any, 'u1');
    expect(calls.filter(c => c.sql.includes('lead_actions'))).toHaveLength(0);
    expect(repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ nextContactAt: later, meetingResult: null }));
    const ev = calls.find(c => c.sql.includes('INSERT INTO lead_events'));
    expect(ev?.params.slice(0, 3)).toEqual([L1, 'u1', 'meeting_set']);
    expect(JSON.parse(ev!.params[3])).toEqual({ at: later.toISOString() });
  });

  it('та же встреча (строка и Date одного момента) — итог не сбрасываем', async () => {
    const before = lead({ nextContactAt: future, meetingResult: 'held' });
    const { svc, repo } = makeService({ leads: [before, before] });
    await svc.update(L1, { nextContactAt: future.toISOString() } as any, 'u1');
    expect(repo.update.mock.calls[0][1]).not.toHaveProperty('meetingResult');
  });

  it('правка лида без смены встречи; «Написал» — одно письмо в KPI и событие в ленте', async () => {
    const { svc, calls } = makeService({
      leads: [lead({ nextContactAt: future }), lead({ nextContactAt: future, emailStatus: 'sent' })],
    });
    await svc.update(L1, { emailStatus: 'sent' } as any, 'u1');
    const touched = calls.filter(c => c.sql.includes('lead_actions'));
    expect(touched).toHaveLength(1);
    expect(touched[0].sql).toContain('email');
    expect(touched[0].params).toEqual(['u1', L1]);
    expect(calls.some(c => c.sql.includes('INSERT INTO lead_events') && c.params[2] === 'email')).toBe(true);
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
    // Событий звонков нет — ноль, а не счёт по состоянию лидов.
    expect(by.cold_calls).toMatchObject({ value: 0, target: 100, label: 'Звонки' });
    // Встречи — отмеченные «состоялась», до «сейчас», не до конца воскресенья.
    const meet = calls.find(c => c.sql.includes('FROM lead_actions') && c.params[1] === 'meeting')!;
    expect(meet.sql).toContain('COALESCE("at", created_at) BETWEEN');
    expect(meet.params[2].toISOString()).toBe('2026-11-08T19:00:00.000Z');
    expect(meet.params[3]).toEqual(NOW);
  });

  it('нормы — из настроек продаж по направлению менеджера', async () => {
    const settings = [{ key: 'kpi_norms', value: { smm: { meetings: 3, cold_calls: 40 }, development: { meetings: 1 } } }];
    const extra: Responder = sql => (sql.includes('FROM sales_settings') ? settings : undefined);
    const { svc } = makeService({ respond: respond({}, extra) });
    const smmKpi = await svc.kpi('u1', 'smm' as any, '2026-11-09', '2026-11-14');
    const by = Object.fromEntries(smmKpi.items.map(i => [i.key, i.target]));
    expect(by).toMatchObject({ meetings: 15, cold_calls: 200, new_companies: 75 }); // 5 дней; остальное — по умолчанию
    const devKpi = await makeService({ respond: respond({}, extra) }).svc.kpi('u1', 'development' as any, '2026-11-09', '2026-11-14');
    expect(devKpi.items.find(i => i.key === 'meetings')!.target).toBe(5);
    // Без направления — нормы по умолчанию.
    const none = await makeService({ respond: respond({}, extra) }).svc.kpi('u1', undefined, '2026-11-09', '2026-11-14');
    expect(none.items.find(i => i.key === 'meetings')!.target).toBe(10);
  });

  it('статус «В отпуске» без дат — выходной только с сегодняшнего дня, прошлое не обнуляется', async () => {
    const extra: Responder = sql => (sql.includes('FROM employees') ? [{ from: null, until: null }] : undefined);
    const { svc } = makeService({ respond: respond({}, extra) });
    // 09–14.11: 6 рабочих дней минус отгул 12.11 минус сегодня (14.11) = 4.
    expect((await svc.kpi('u1', undefined, '2026-11-09', '2026-11-14')).workDays).toBe(4);
    // Октябрь целиком остаётся рабочим: 27 дней.
    expect((await svc.kpi('u1', undefined, '2026-10-01', '2026-10-31')).workDays).toBe(27);
  });

  it('период до 16.06.2026 — звонки по старому счёту', async () => {
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

// 15.11.2026: «Продвижения по воронке» — вехи. +1 только за первое
// достижение этапа лидом; назад и в проигрыш — 0, без штрафа. Этап —
// только status; вехи старых этапов онбординга эквивалентны новым.
describe('воронка — вехи вместо дельт', () => {
  const progressInserts = (calls: Call[]) => calls.filter(c => c.sql.includes('INSERT INTO lead_progress'));
  const milestoneChecks = (calls: Call[]) => calls.filter(c => c.sql.includes('SELECT 1 FROM lead_progress'));
  const respondReached = (reached: boolean): Responder => sql =>
    (sql.includes('SELECT 1 FROM lead_progress') ? (reached ? [{ '?column?': 1 }] : []) : []);

  it('new → waiting впервые: +1 владельцу, в журнал — id лида', async () => {
    const { svc, calls } = makeService({ respond: respondReached(false), leads: [lead({ status: 'new' }), lead({ status: 'waiting' })] });
    await svc.updateWithAuth(L1, { status: 'waiting' } as any, smm);
    const ins = progressInserts(calls);
    expect(ins).toHaveLength(1);
    expect(ins[0].params[0]).toBe('u1');
    // Этапы онбординга больше не пишем.
    expect(ins[0].params.slice(3)).toEqual([null, null, 'new', 'waiting', 1]);
    const log = ((svc as any).activityLog.log as jest.Mock).mock.calls[0][0];
    expect(log.entityId).toBe(L1);
  });

  it('waiting уже был у лида — повторный заход не засчитывается', async () => {
    const { svc, calls } = makeService({ respond: respondReached(true), leads: [lead({ status: 'new' }), lead({ status: 'waiting' })] });
    await svc.updateWithAuth(L1, { status: 'waiting' } as any, smm);
    expect(progressInserts(calls)).toHaveLength(0);
  });

  it('веха проверяется и по старым этапам онбординга: meeting ≡ meeting, proposal ≡ kp_creation, waiting ≡ negotiation', async () => {
    for (const [to, statuses, stages] of [
      ['meeting', ['meeting'], ['meeting']],
      ['proposal', ['proposal'], ['kp_creation']],
      ['contract', ['contract'], ['contract']],
      ['won', ['won'], ['implementation']],
    ] as Array<[string, string[], string[]]>) {
      const { svc, calls } = makeService({ respond: respondReached(true), leads: [lead({ status: 'waiting' }), lead({ status: to })] });
      await svc.updateWithAuth(L1, { status: to } as any, smm);
      const check = milestoneChecks(calls)[0];
      expect(check.sql).toContain('stage_to = ANY($3::text[])');
      expect(check.params).toEqual([L1, statuses, stages]);
      // Взята старым этапом — второй раз не засчитываем.
      expect(progressInserts(calls)).toHaveLength(0);
    }
    const { svc, calls } = makeService({ respond: respondReached(false), leads: [lead({ status: 'new' }), lead({ status: 'waiting' })] });
    await svc.updateWithAuth(L1, { status: 'waiting' } as any, smm);
    expect(milestoneChecks(calls)[0].params).toEqual([L1, ['waiting', 'negotiating'], ['negotiation']]);
  });

  it('назад (waiting → new) и в проигрыш (won → lost) — 0, без записи −1', async () => {
    for (const [from, to, extra] of [['waiting', 'new', {}], ['won', 'lost', { lostReason: 'price' }]] as const) {
      const { svc, calls } = makeService({
        respond: respondReached(false),
        leads: [lead({ status: from }), lead({ status: to, ...extra })],
      });
      await svc.updateWithAuth(L1, { status: to, ...extra } as any, smm);
      expect(progressInserts(calls)).toHaveLength(0);
      // Проверять вехи даже не нужно — шаг не вперёд.
      expect(milestoneChecks(calls)).toHaveLength(0);
    }
  });

  it('руководитель двигает лид менеджера — зачёт владельцу-МП (из устаревшего negotiating ≡ waiting)', async () => {
    const { svc, calls } = makeService({
      respond: respondReached(false), leads: [lead({ status: 'negotiating' }), lead({ status: 'proposal' })],
    });
    await svc.updateWithAuth(L1, { status: 'proposal' } as any, { id: 'boss', role: 'admin' });
    const ins = progressInserts(calls);
    expect(ins).toHaveLength(1);
    expect(ins[0].params[0]).toBe('u1');
  });

  it('создание лида сразу в «КП» продвижения не даёт', async () => {
    const { svc, calls } = makeService({ respond: respondReached(false) });
    await svc.create({ name: 'Новый клиент', status: 'proposal', direction: 'smm' } as any, 'u1', { id: 'u1' });
    expect(milestoneChecks(calls)).toHaveLength(0);
    expect(progressInserts(calls)).toHaveLength(0);
    // Зато в ленте — «создан».
    const created = calls.find(c => c.sql.includes('INSERT INTO lead_events') && c.params[2] === 'created');
    expect(JSON.parse(created!.params[3])).toMatchObject({ status: 'proposal', direction: 'smm', via: 'form' });
  });
});

describe('холодные звонки — один на лид в день', () => {
  it('отметка «Холодный» пишет событие только если сегодня его ещё не было', async () => {
    const { svc, calls } = makeService({ leads: [lead({ callType: 'neutral' }), lead({ callType: 'cold' })] });
    await svc.updateWithAuth(L1, { callType: 'cold' } as any, smm);
    const cold = calls.find(c => c.sql.includes("'cold_call'") && c.sql.includes('INSERT INTO lead_actions'));
    expect(cold?.sql).toContain('WHERE NOT EXISTS');
    expect(cold?.sql).toContain("AT TIME ZONE 'Asia/Dushanbe'");
    expect(cold?.params).toEqual(['u1', L1]);
  });
});
