import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ClientsService } from './clients.service';

// Продажи, этап 2 (15.11.2026, docs/SALES_SPEC.md): дубли при создании,
// причина проигрыша, правила владельца, «Взять себе», удаление ничьих
// лидов, список с фильтрами, прогноз, «Позвонить» в Telegram.
// База — заглушка: отвечаем по тексту запроса.

type Responder = (sql: string, params: any[]) => any;
type Call = { sql: string; params: any[] };

const L1 = '0b0b0b0b-0000-4000-8000-000000000001';
const L2 = '0b0b0b0b-0000-4000-8000-000000000002';
const MP1 = '0a0a0a0a-0000-4000-8000-000000000001';
const MP2 = '0a0a0a0a-0000-4000-8000-000000000002';
const DEV = '0a0a0a0a-0000-4000-8000-000000000003';
const DESIGNER = '0a0a0a0a-0000-4000-8000-000000000004';
const BOSS = '0a0a0a0a-0000-4000-8000-000000000005';

const USERS: Record<string, any> = {
  [MP1]: { id: MP1, name: 'Алишер', role: 'sales_manager_smm', secondaryRole: null, isActive: true, isBlocked: false },
  [MP2]: { id: MP2, name: 'Мадина', role: 'sales_manager_smm', secondaryRole: null, isActive: true, isBlocked: false },
  [DEV]: { id: DEV, name: 'Сабрина', role: 'sales_manager_dev', secondaryRole: null, isActive: true, isBlocked: false },
  [DESIGNER]: { id: DESIGNER, name: 'Фарид', role: 'designer', secondaryRole: null, isActive: true, isBlocked: false },
  [BOSS]: { id: BOSS, name: 'Основатель', role: 'founder', secondaryRole: null, isActive: true, isBlocked: false },
};
const mp1 = { id: MP1, role: 'sales_manager_smm', name: 'Алишер' };
const boss = { id: BOSS, role: 'founder', name: 'Основатель' };

function makeService(opts: { respond?: Responder; leads?: any[]; affected?: number; found?: any[] } = {}) {
  const calls: Call[] = [];
  const respond = opts.respond ?? (() => []);
  const manager = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return respond(sql, params);
    }),
  };
  const queue = [...(opts.leads ?? [])];
  let last: any = null;
  const qb: any = {};
  for (const m of ['where', 'andWhere', 'leftJoin', 'leftJoinAndSelect', 'addSelect', 'select', 'groupBy',
    'orderBy', 'addOrderBy', 'limit', 'offset']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn(async () => (last ? { ...last } : null));
  qb.getMany = jest.fn(async () => []);
  qb.getManyAndCount = jest.fn(async () => [[{ id: L1, name: 'Кофейня', owner: { id: MP1, name: 'Алишер', email: 'x@y' } }], 1]);
  qb.getCount = jest.fn(async () => 0);
  qb.getRawMany = jest.fn(async () => []);
  qb.getRawOne = jest.fn(async () => ({ total: '1000', forecast: '450.4' }));
  const repo: any = {
    manager,
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => {
      const l = queue.length ? queue.shift() : last;
      last = l;
      return l ? { ...l } : null;
    }),
    find: jest.fn(async () => opts.found ?? []),
    update: jest.fn(async () => ({ affected: opts.affected ?? 1 })),
    create: jest.fn((x: any) => ({ id: L1, ...x })),
    save: jest.fn(async (x: any) => { last = x; return x; }),
    delete: jest.fn(async () => ({ affected: 1 })),
    query: jest.fn(async () => []),
  };
  const userRepo: any = {
    findOne: jest.fn(async ({ where }: any) => USERS[where?.id] ?? null),
    find: jest.fn(async () => Object.values(USERS)),
  };
  const telegram: any = { appUrl: 'https://crm.test', sendToUser: jest.fn(async () => undefined) };
  const notifications: any = { create: jest.fn(async () => undefined) };
  const svc = new ClientsService(
    repo, { delete: jest.fn(async () => undefined), findOne: jest.fn(), update: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
    { manager, createQueryBuilder: jest.fn(() => qb) } as any, userRepo, {} as any,
    { log: jest.fn() } as any, { broadcast: jest.fn() } as any, notifications, telegram,
  );
  return { svc, calls, repo, qb, telegram, notifications };
}

const lead = (patch: any = {}) => ({
  id: L1, name: 'Кофейня', ownerId: MP1, status: 'waiting', direction: 'smm', lostReason: null,
  rejectionReason: null, nextContactAt: null, onHold: false, meetingResult: null, ...patch,
});

describe('дубли при создании', () => {
  const dupRow = { id: L2, name: 'Кофейня «Сафо»', status: 'waiting', contactPhone: '+992 900 11 22 33', ownerName: 'Мадина' };
  const respondDup: Responder = sql => (sql.includes('regexp_replace') ? [dupRow] : []);

  it('похожий телефон в том же направлении → 409 duplicate со списком', async () => {
    const { svc, repo, calls } = makeService({ respond: respondDup });
    const err = await svc.create({ name: 'Сафо', contactPhone: '900112233', direction: 'smm' } as any, MP1, { id: MP1 })
      .catch(e => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toEqual({
      message: 'duplicate',
      duplicates: [{ id: L2, name: 'Кофейня «Сафо»', status: 'waiting', ownerName: 'Мадина' }],
    });
    expect(repo.save).not.toHaveBeenCalled();
    // Ищем в направлении лида: телефон — последние 9 цифр.
    const q = calls.find(c => c.sql.includes('regexp_replace'))!;
    expect(q.params.slice(0, 4)).toEqual(['smm', 'сафо', '900112233', null]);
  });

  it('совпало только грубое условие SQL, а точное — нет: не дубль', async () => {
    const { svc, repo } = makeService({ respond: sql => (sql.includes('regexp_replace') ? [{ ...dupRow, contactPhone: '+992 900 11 22 34' }] : []) });
    await svc.create({ name: 'Сафо', contactPhone: '900112233' } as any, MP1, { id: MP1 });
    expect(repo.save).toHaveBeenCalled();
  });

  it('force: true — создаём, дубли не ищем', async () => {
    const { svc, repo, calls } = makeService({ respond: respondDup });
    const created = await svc.create({ name: 'Сафо', contactPhone: '900112233', force: true } as any, MP1, { id: MP1 });
    expect(repo.save).toHaveBeenCalled();
    expect(repo.save.mock.calls[0][0]).not.toHaveProperty('force');
    expect(calls.some(c => c.sql.includes('regexp_replace'))).toBe(false);
    expect(created.id).toBe(L1);
  });

  it('через createWithAuth (POST /clients) — то же; «Директ» — с пометкой via', async () => {
    const { svc } = makeService({ respond: respondDup });
    await expect(svc.createWithAuth({ name: 'Сафо', contactPhone: '900112233' } as any, mp1)).rejects.toBeInstanceOf(ConflictException);
    const ok = makeService();
    await ok.svc.create({ name: 'Новый' } as any, MP1, { id: MP1 }, { via: 'direct' });
    const ev = ok.calls.find(c => c.sql.includes('INSERT INTO lead_events') && c.params[2] === 'created')!;
    expect(JSON.parse(ev.params[3]).via).toBe('direct');
  });
});

describe('этап и причина проигрыша', () => {
  it('создание «Проиграно» без причины → 400', async () => {
    const { svc, repo } = makeService();
    await expect(svc.create({ name: 'X', status: 'lost' } as any, MP1, { id: MP1 }))
      .rejects.toThrow(new BadRequestException('Укажите причину проигрыша'));
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('PATCH в lost без причины → 400; «Другое» без текста → 400; с причиной — ок, причина в ленте', async () => {
    const a = makeService({ leads: [lead()] });
    await expect(a.svc.updateWithAuth(L1, { status: 'lost' } as any, mp1)).rejects.toThrow('Укажите причину проигрыша');
    expect(a.repo.update).not.toHaveBeenCalled();

    const b = makeService({ leads: [lead()] });
    await expect(b.svc.updateWithAuth(L1, { status: 'lost', lostReason: 'other' } as any, mp1))
      .rejects.toThrow('Опишите причину проигрыша');

    const c = makeService({ leads: [lead(), lead({ status: 'lost', lostReason: 'price' })] });
    await c.svc.updateWithAuth(L1, { status: 'lost', lostReason: 'price' } as any, mp1);
    expect(c.repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ status: 'lost', lostReason: 'price' }));
    const ev = c.calls.find(x => x.sql.includes('INSERT INTO lead_events') && x.params[2] === 'stage')!;
    expect(JSON.parse(ev.params[3])).toEqual({ from: 'waiting', to: 'lost', lostReason: 'price' });
  });

  it('правка старого проигранного лида по другим полям причину не требует; вернули в работу — код причины снят', async () => {
    const old = lead({ status: 'lost', lostReason: 'other', rejectionReason: null });
    const a = makeService({ leads: [old, old] });
    await a.svc.updateWithAuth(L1, { contactPhone: '900000000' } as any, mp1);
    expect(a.repo.update).toHaveBeenCalled();

    const b = makeService({ leads: [old, lead({ status: 'waiting' })] });
    await b.svc.updateWithAuth(L1, { status: 'waiting' } as any, mp1);
    expect(b.repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ status: 'waiting', lostReason: null }));
  });

  it('устаревший этап (negotiating) не принимаем; onboardingStage молча отбрасываем', async () => {
    const a = makeService({ leads: [lead()] });
    await expect(a.svc.updateWithAuth(L1, { status: 'negotiating' } as any, mp1)).rejects.toBeInstanceOf(BadRequestException);
    const b = makeService({ leads: [lead(), lead()] });
    await b.svc.updateWithAuth(L1, { onboardingStage: 'contract', nextStep: 'Позвонить' } as any, mp1);
    expect(b.repo.update.mock.calls[0][1]).not.toHaveProperty('onboardingStage');
    expect(b.repo.update.mock.calls[0][1]).toHaveProperty('nextStep', 'Позвонить');
  });
});

describe('владелец лида', () => {
  it('МП передаёт свой лид МП своего направления — ок, в ленте «owner» с именами', async () => {
    const { svc, repo, calls } = makeService({ leads: [lead(), lead({ ownerId: MP2 })] });
    await svc.updateWithAuth(L1, { ownerId: MP2 } as any, mp1);
    expect(repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ ownerId: MP2 }));
    const ev = calls.find(c => c.sql.includes('INSERT INTO lead_events') && c.params[2] === 'owner')!;
    expect(JSON.parse(ev.params[3])).toEqual({ fromId: MP1, fromName: 'Алишер', toId: MP2, toName: 'Мадина' });
  });

  it('МП: дизайнеру или МП разработки — 400; чужой лид — 403; снять владельца — 403', async () => {
    for (const to of [DESIGNER, DEV]) {
      const { svc, repo } = makeService({ leads: [lead()] });
      await expect(svc.updateWithAuth(L1, { ownerId: to } as any, mp1)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    }
    const other = makeService({ leads: [lead({ ownerId: MP2 })] });
    await expect(other.svc.updateWithAuth(L1, { ownerId: MP1 } as any, mp1)).rejects.toBeInstanceOf(ForbiddenException);
    const unset = makeService({ leads: [lead()] });
    await expect(unset.svc.updateWithAuth(L1, { ownerId: null } as any, mp1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('МП: лид чужого направления править нельзя', async () => {
    const { svc } = makeService({ leads: [lead({ direction: 'development', ownerId: null })] });
    await expect(svc.updateWithAuth(L1, { nextStep: 'x' } as any, mp1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('руководство: любой МП направления лида или «без владельца»; МП другого направления — 400', async () => {
    const a = makeService({ leads: [lead(), lead({ ownerId: MP2 })] });
    await a.svc.updateWithAuth(L1, { ownerId: MP2 } as any, boss);
    expect(a.repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ ownerId: MP2 }));
    const b = makeService({ leads: [lead(), lead({ ownerId: null })] });
    await b.svc.updateWithAuth(L1, { ownerId: null } as any, boss);
    expect(b.repo.update).toHaveBeenCalledWith(L1, expect.objectContaining({ ownerId: null }));
    const c = makeService({ leads: [lead()] });
    await expect(c.svc.updateWithAuth(L1, { ownerId: DEV } as any, boss)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('создание: основатель ставит менеджера или «без владельца»; МП — себе; дизайнер — 400', async () => {
    const a = makeService();
    await a.svc.createWithAuth({ name: 'A', direction: 'smm', ownerId: MP2 } as any, boss);
    expect(a.repo.create.mock.calls[0][0].ownerId).toBe(MP2);
    const b = makeService();
    await b.svc.createWithAuth({ name: 'B', direction: 'smm', ownerId: null } as any, boss);
    expect(b.repo.create.mock.calls[0][0].ownerId).toBeNull();
    const c = makeService();
    await c.svc.createWithAuth({ name: 'C', direction: 'smm' } as any, mp1);
    expect(c.repo.create.mock.calls[0][0].ownerId).toBe(MP1);
    const d = makeService();
    await expect(d.svc.createWithAuth({ name: 'D', direction: 'smm', ownerId: DESIGNER } as any, boss))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('«Взять себе» и удаление ничьих лидов', () => {
  it('claim: лид без владельца своего направления — UPDATE … WHERE ownerId IS NULL', async () => {
    const { svc, repo } = makeService({ leads: [lead({ ownerId: null, direction: null }), lead({ ownerId: MP1 })] });
    await svc.claim(L1, mp1);
    const [where, patch] = repo.update.mock.calls[0];
    expect(where.id).toBe(L1);
    expect(String(where.ownerId.type)).toBe('isNull');
    // Старый лид без направления становится лидом направления взявшего.
    expect(patch).toMatchObject({ ownerId: MP1, direction: 'smm' });
  });

  it('claim: успел другой — 409; уже чей-то — 409; чужое направление — 403', async () => {
    const race = makeService({ leads: [lead({ ownerId: null })], affected: 0 });
    await expect(race.svc.claim(L1, mp1)).rejects.toBeInstanceOf(ConflictException);
    const taken = makeService({ leads: [lead({ ownerId: MP2 })] });
    await expect(taken.svc.claim(L1, mp1)).rejects.toThrow('Лид уже ведёт Мадина');
    const dev = makeService({ leads: [lead({ ownerId: null, direction: 'development' })] });
    await expect(dev.svc.claim(L1, mp1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('удалить лид без владельца может только руководство', async () => {
    const a = makeService({ leads: [lead({ ownerId: null })] });
    await expect(a.svc.removeWithAuth(L1, mp1)).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.repo.delete).not.toHaveBeenCalled();
    const b = makeService({ leads: [lead({ ownerId: null })] });
    await b.svc.removeWithAuth(L1, boss);
    expect(b.repo.delete).toHaveBeenCalledWith(L1);
    const c = makeService({ leads: [lead(), lead()] });
    await c.svc.removeWithAuth(L1, mp1);
    expect(c.repo.delete).toHaveBeenCalledWith(L1);
  });
});

describe('GET /clients/list и /clients/board', () => {
  const sqlOf = (qb: any) => qb.andWhere.mock.calls.map((c: any[]) => String(c[0])).join('\n');

  it('МП по умолчанию — свои; «Просрочено» — по ближайшему действию; owner только { id, name }', async () => {
    const { svc, qb } = makeService();
    const page = await svc.list({ due: 'overdue' }, mp1, 'smm' as any);
    const sql = sqlOf(qb);
    expect(sql).toContain('c.ownerId = :oid');
    expect(qb.andWhere.mock.calls.find((c: any[]) => c[0] === 'c.ownerId = :oid')[1]).toEqual({ oid: MP1 });
    expect(sql).toContain('LEAST(CASE WHEN c."meetingResult" IS NULL THEN c."nextContactAt" END, c."repeatCallAt", c."nextStepAt") < :now');
    expect(sql).toContain('c."onHold" = false');
    expect(qb.offset).toHaveBeenCalledWith(0);
    expect(qb.limit).toHaveBeenCalledWith(20);
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(page.items[0].owner).toEqual({ id: MP1, name: 'Алишер' });
    // Владелец — только id и имя.
    expect(qb.addSelect).toHaveBeenCalledWith(['owner.id', 'owner.name']);
  });

  it('руководство по умолчанию — все; страница 3 по 50; сортировка по потенциалу', async () => {
    const { svc, qb } = makeService();
    await svc.list({ page: '3', pageSize: '50', sort: 'potential' }, boss);
    expect(sqlOf(qb)).not.toContain('c.ownerId');
    expect(qb.orderBy).toHaveBeenCalledWith('c.dealPotential', 'DESC', 'NULLS LAST');
    expect(qb.offset).toHaveBeenCalledWith(100);
    expect(qb.limit).toHaveBeenCalledWith(50);
  });

  it('доска: активные + закрытые за 30 дней, без лимита 500 (предел 3000)', async () => {
    const { svc, qb } = makeService();
    const res = await svc.board({ owner: 'all' }, mp1, 'smm' as any);
    expect(res).toEqual({ items: [] });
    expect(sqlOf(qb)).toContain(`c.status::text IN ('won', 'lost') AND c."updatedAt" >= :since`);
    expect(qb.limit).toHaveBeenCalledWith(3000);
  });
});

describe('stats — потенциал и прогноз', () => {
  it('потенциал без won и lost; прогноз — по активным, не на паузе', async () => {
    const { svc, qb } = makeService();
    const s = await svc.stats();
    expect(s.openPotential).toBe(1000);
    expect(s.totalPotential).toBe(1000);
    expect(s.forecast).toBe(450);
    const where = qb.where.mock.calls.map((c: any[]) => c);
    expect(where.find((c: any[]) => String(c[0]).includes('NOT IN'))[1]).toEqual({ closed: ['won', 'lost'] });
    const fc = where.find((c: any[]) => String(c[0]).includes(':...forecastSt'))[1].forecastSt;
    expect(fc).toEqual(expect.arrayContaining(['new', 'waiting', 'meeting', 'proposal', 'contract']));
    expect(fc).not.toContain('won');
    expect(fc).not.toContain('on_hold');
    expect(qb.select.mock.calls.some((c: any[]) => String(c[0]).includes("WHEN 'proposal' THEN 60"))).toBe(true);
  });
});

describe('«Позвонить» — и в Telegram', () => {
  it('менеджер получает сообщение с клиентами (HTML экранирован) и ссылкой', async () => {
    const { svc, telegram, notifications } = makeService({
      found: [{ id: L1, name: 'Кафе <Сафо>', ownerId: MP1, direction: 'smm' }, { id: L2, name: 'Нур', ownerId: MP1, direction: 'smm' }],
    });
    const res = await svc.setCallRequest([L1, L2], true, boss);
    expect(res).toMatchObject({ ok: true, updated: 2 });
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(telegram.sendToUser).toHaveBeenCalledTimes(1);
    const [to, text] = telegram.sendToUser.mock.calls[0];
    expect(to).toBe(MP1);
    expect(text).toContain('Кафе &lt;Сафо&gt;');
    expect(text).toContain('2 клиентов');
    expect(text).toContain('https://crm.test/clients?callRequested=1');
  });

  it('МП ставить отметку не может', async () => {
    const { svc } = makeService();
    await expect(svc.setCallRequest([L1], true, mp1)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
