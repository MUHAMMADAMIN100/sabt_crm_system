import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SalesService, rowsOf } from './sales.service';
import { canActOnLead, canViewLead, handoffDirectionsFor } from './sales-access';

// SalesService на заглушках (15.11.2026): база отвечает по тексту запроса,
// ClientsService — шпион. Проверяем эффекты действий: поля лида, события,
// KPI в lead_actions, этап — только через ClientsService.updateWithAuth.

const NOW = new Date('2026-11-15T10:00:00Z'); // 15:00 по Душанбе
const MP = { id: '11111111-1111-1111-1111-111111111111', name: 'Фарход', role: 'sales_manager_smm', secondaryRole: null };
const MP2 = { id: '22222222-2222-2222-2222-222222222222', name: 'Нигина', role: 'sales_manager_smm', secondaryRole: null };
const FOUNDER = { id: '99999999-9999-9999-9999-999999999999', name: 'Основатель', role: 'founder', secondaryRole: null };
const DIRECTOR = { id: '33333333-3333-3333-3333-333333333333', name: 'Руководитель SMM', role: 'smm_director', secondaryRole: null };
const LEAD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Responder = (sql: string, params: any[]) => any;

function makeSales(opts: { lead?: Record<string, any>; respond?: Responder; people?: any[]; users?: any[] } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const lead: Record<string, any> = {
    id: LEAD_ID, name: 'Кафе «Сафо»', status: 'new', ownerId: MP.id, direction: 'smm',
    nextContactAt: null, meetingResult: null, repeatCallAt: null, callType: null, emailStatus: null,
    callRequested: false, handoffAt: null, handoffById: null, handoffData: null, projectId: null,
    ...(opts.lead || {}),
  };
  const respond = opts.respond ?? (() => []);
  const manager: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return respond(sql, params);
    }),
  };
  manager.transaction = jest.fn(async (fn: (m: any) => Promise<any>) => fn(manager));
  const leadRepo: any = {
    manager,
    findOne: jest.fn(async (o: any) => (o?.relations
      ? { ...lead, owner: { id: MP.id, name: MP.name, email: 'x@y', role: MP.role } }
      : { ...lead })),
    update: jest.fn(async () => undefined),
    find: jest.fn(async () => []),
  };
  const users = [MP, MP2, FOUNDER, DIRECTOR, ...(opts.users || [])];
  const userRepo: any = {
    findOne: jest.fn(async (o: any) => users.find(u => u.id === o?.where?.id) ?? null),
    find: jest.fn(async () => opts.people ?? []),
  };
  const taskRepo: any = {
    create: jest.fn((v: any) => v),
    save: jest.fn(async (v: any) => ({ id: 'tttttttt-tttt-tttt-tttt-tttttttttttt', ...v })),
    findOne: jest.fn(async () => null),
    update: jest.fn(async () => undefined),
  };
  const clients: any = { updateWithAuth: jest.fn(async () => ({})) };
  const notifications: any = { create: jest.fn(async () => ({})) };
  const telegram: any = { sendToUser: jest.fn(async () => undefined) };
  const gateway: any = { broadcast: jest.fn() };
  const svc = new SalesService(leadRepo, userRepo, taskRepo, clients, notifications, telegram, gateway);
  const events = () => calls
    .filter(c => c.sql.includes('INSERT INTO lead_events'))
    .map(c => ({ kind: c.params[2] ?? 'comment', data: JSON.parse(c.params[c.params.length - 1]) }));
  const kpi = () => calls.filter(c => c.sql.includes('INSERT INTO lead_actions'));
  return { svc, calls, leadRepo, userRepo, taskRepo, clients, notifications, telegram, gateway, events, kpi };
}

beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('доступ к лиду', () => {
  it('владелец; ничей своего направления — любой МП; чужой — нет; руководство — любой', () => {
    expect(canActOnLead(MP, { ownerId: MP.id, direction: 'smm' })).toBe(true);
    expect(canActOnLead(MP2, { ownerId: MP.id, direction: 'smm' })).toBe(false);
    expect(canActOnLead(MP2, { ownerId: null, direction: 'smm' })).toBe(true);
    expect(canActOnLead(MP2, { ownerId: null, direction: 'development' })).toBe(false);
    expect(canActOnLead(MP2, { ownerId: null, direction: null })).toBe(true);
    expect(canActOnLead(FOUNDER, { ownerId: MP.id, direction: 'development' })).toBe(true);
    // Вторая роль МП тоже даёт направление.
    expect(canActOnLead({ id: 'd1', role: 'designer', secondaryRole: 'sales_manager_dev' }, { ownerId: null, direction: 'development' })).toBe(true);
    expect(canActOnLead({ id: 'e1', role: 'employee' }, { ownerId: null, direction: 'smm' })).toBe(false);
    // Свой лид чужого направления — нет (как ClientsService.updateWithAuth); не-МП владелец — да.
    expect(canActOnLead(MP, { ownerId: MP.id, direction: 'development' })).toBe(false);
    expect(canActOnLead({ id: 'e1', role: 'employee' }, { ownerId: 'e1', direction: 'smm' })).toBe(true);
  });

  it('ленту событий коллеги своего направления читать можно, чужого направления — нет', () => {
    expect(canViewLead(MP2, { ownerId: MP.id, direction: 'smm' })).toBe(true);
    expect(canViewLead(MP2, { ownerId: MP.id, direction: 'development' })).toBe(false);
  });

  it('«Заявки от продаж»: руководство — все, директора — своё направление, остальные — никакие', () => {
    expect(handoffDirectionsFor(FOUNDER)).toBeNull();
    expect(handoffDirectionsFor({ id: 'a', role: 'admin' })).toBeNull();
    expect(handoffDirectionsFor(DIRECTOR)).toEqual(['smm']);
    expect(handoffDirectionsFor({ id: 'd', role: 'developer', secondaryRole: 'dev_director' })).toEqual(['development']);
    expect(handoffDirectionsFor(MP)).toEqual([]);
  });
});

describe('POST /sales/leads/:id/calls', () => {
  it('дозвонился у нового: поля, событие, KPI «Звонки», этап «Контакт» через ClientsService, сокет', async () => {
    const t = makeSales();
    const res = await t.svc.logCall(LEAD_ID, { result: 'reached', outcome: 'interested', comment: ' Ждёт КП ' }, MP as any);
    expect(t.leadRepo.update).toHaveBeenCalledWith(LEAD_ID, {
      lastContactAt: '2026-11-15', lastActivityAt: NOW, callType: 'cold',
    });
    expect(t.events()).toEqual([{ kind: 'call', data: { result: 'reached', outcome: 'interested', comment: 'Ждёт КП' } }]);
    const kpi = t.kpi();
    expect(kpi).toHaveLength(1);
    expect(kpi[0].sql).toContain(`'cold_call'`);
    expect(kpi[0].sql).toContain('NOT EXISTS');
    expect(kpi[0].params).toEqual([MP.id, LEAD_ID]);
    expect(t.clients.updateWithAuth).toHaveBeenCalledWith(LEAD_ID, { status: 'waiting' }, MP);
    expect(t.gateway.broadcast).toHaveBeenCalledWith('leads:changed', { leadId: LEAD_ID, ownerId: MP.id });
    // Ответ — лид с владельцем { id, name }.
    expect(res.owner).toEqual({ id: MP.id, name: MP.name });
  });

  it('не дозвонился: этап не меняется, тип звонка не затираем, звонок в KPI всё равно', async () => {
    const t = makeSales({ lead: { callType: 'hot', status: 'waiting' } });
    await t.svc.logCall(LEAD_ID, { result: 'no_answer' }, MP as any);
    expect(t.leadRepo.update.mock.calls[0][1]).not.toHaveProperty('callType');
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
    expect(t.kpi()).toHaveLength(1);
  });

  it('звонил основатель по лиду МП — звонок в KPI менеджера-владельца', async () => {
    const t = makeSales();
    await t.svc.logCall(LEAD_ID, { result: 'busy' }, FOUNDER as any);
    expect(t.kpi()[0].params).toEqual([MP.id, LEAD_ID]);
  });

  it('следующий шаг: встреча — nextContactAt без итога и событие meeting_set; перезвон в срок снят', async () => {
    const t = makeSales({ lead: { repeatCallAt: new Date('2026-11-15T04:00:00Z'), meetingResult: 'missed' } });
    await t.svc.logCall(LEAD_ID, { result: 'reached', next: { kind: 'meeting', at: '2026-11-17T06:00:00.000Z' } }, MP as any);
    const patch = t.leadRepo.update.mock.calls[0][1];
    expect(patch.nextContactAt).toEqual(new Date('2026-11-17T06:00:00.000Z'));
    expect(patch.meetingResult).toBeNull();
    expect(patch.repeatCallAt).toBeNull();
    expect(t.events().map(e => e.kind)).toEqual(['call', 'meeting_set']);
    expect(t.events()[1].data).toEqual({ at: '2026-11-17T06:00:00.000Z' });
  });

  it('следующий шаг «шаг» без текста или в прошлом — 400, ничего не записано', async () => {
    const t = makeSales();
    await expect(t.svc.logCall(LEAD_ID, { result: 'reached', next: { kind: 'step', at: '2026-11-17T06:00:00Z' } }, MP as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.logCall(LEAD_ID, { result: 'reached', next: { kind: 'callback', at: '2026-11-14T06:00:00Z' } }, MP as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(t.leadRepo.update).not.toHaveBeenCalled();
    expect(t.calls).toHaveLength(0);
  });

  it('шаг с текстом — nextStep/nextStepAt и событие next_step', async () => {
    const t = makeSales({ lead: { status: 'waiting' } });
    await t.svc.logCall(LEAD_ID, { result: 'reached', next: { kind: 'step', at: '2026-11-16T06:00:00Z', text: 'Отправить КП' } }, MP as any);
    const patch = t.leadRepo.update.mock.calls[0][1];
    expect(patch.nextStep).toBe('Отправить КП');
    expect(patch.nextStepAt).toEqual(new Date('2026-11-16T06:00:00Z'));
    expect(t.events()[1]).toEqual({ kind: 'next_step', data: { text: 'Отправить КП', at: '2026-11-16T06:00:00.000Z' } });
  });

  it('лид коллеги — 403, ничего не записано', async () => {
    const t = makeSales();
    await expect(t.svc.logCall(LEAD_ID, { result: 'reached' }, MP2 as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.leadRepo.update).not.toHaveBeenCalled();
  });

  it('сбой смены этапа звонок не отменяет', async () => {
    const t = makeSales();
    t.clients.updateWithAuth.mockRejectedValueOnce(new Error('boom'));
    await expect(t.svc.logCall(LEAD_ID, { result: 'reached' }, MP as any)).resolves.toBeTruthy();
    expect(t.kpi()).toHaveLength(1);
  });
});

describe('POST /sales/leads/:id/emails', () => {
  it('«Написал», если статус письма пуст; KPI «Письма» — 1 на лид в день', async () => {
    const t = makeSales();
    await t.svc.logEmail(LEAD_ID, { comment: 'Презентация' }, MP as any);
    expect(t.leadRepo.update).toHaveBeenCalledWith(LEAD_ID, { lastActivityAt: NOW, emailStatus: 'sent' });
    expect(t.events()).toEqual([{ kind: 'email', data: { comment: 'Презентация' } }]);
    const kpi = t.kpi();
    expect(kpi[0].sql).toContain(`'email'`);
    expect(kpi[0].sql).toContain('WHERE lead_id = $2::uuid AND kind = \'email\'');
  });

  it('ответ клиента («answered») не затираем', async () => {
    const t = makeSales({ lead: { emailStatus: 'answered' } });
    await t.svc.logEmail(LEAD_ID, {}, MP as any);
    expect(t.leadRepo.update.mock.calls[0][1]).toEqual({ lastActivityAt: NOW });
  });
});

describe('POST /sales/leads/:id/meeting', () => {
  it('состоялась: итог, событие, KPI «Встречи» на сейчас, этап «Встреча» через ClientsService', async () => {
    const t = makeSales({ lead: { status: 'waiting', nextContactAt: new Date('2026-11-15T06:00:00Z') } });
    await t.svc.meetingResult(LEAD_ID, { held: true, comment: 'Договорились' }, MP as any);
    expect(t.leadRepo.update).toHaveBeenCalledWith(LEAD_ID, {
      meetingResult: 'held', lastActivityAt: NOW, lastContactAt: '2026-11-15',
    });
    expect(t.events()).toEqual([{ kind: 'meeting_done', data: { at: '2026-11-15T06:00:00.000Z', comment: 'Договорились' } }]);
    const kpi = t.kpi();
    expect(kpi[0].sql).toContain(`'meeting'`);
    expect(kpi[0].params).toEqual([MP.id, LEAD_ID, NOW]);
    expect(t.clients.updateWithAuth).toHaveBeenCalledWith(LEAD_ID, { status: 'meeting' }, MP);
  });

  it('не состоялась: итог missed, событие, без KPI и без этапа', async () => {
    const t = makeSales({ lead: { status: 'waiting', nextContactAt: new Date('2026-11-14T06:00:00Z') } });
    await t.svc.meetingResult(LEAD_ID, { held: false }, MP as any);
    expect(t.leadRepo.update.mock.calls[0][1].meetingResult).toBe('missed');
    expect(t.events()[0].kind).toBe('meeting_missed');
    expect(t.kpi()).toHaveLength(0);
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
  });

  it('встреча завтра или не назначена — 400 (итог «заранее» — накрутка KPI)', async () => {
    const tomorrow = makeSales({ lead: { nextContactAt: new Date('2026-11-16T05:00:00Z') } });
    await expect(tomorrow.svc.meetingResult(LEAD_ID, { held: true }, MP as any)).rejects.toBeInstanceOf(BadRequestException);
    const none = makeSales();
    await expect(none.svc.meetingResult(LEAD_ID, { held: true }, MP as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tomorrow.kpi()).toHaveLength(0);
  });

  it('этап дальше «Встречи» не откатываем', async () => {
    const t = makeSales({ lead: { status: 'proposal', nextContactAt: new Date('2026-11-15T06:00:00Z') } });
    await t.svc.meetingResult(LEAD_ID, { held: true }, MP as any);
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
  });
});

describe('лента и комментарии', () => {
  it('события — новые сверху, автор { id, name } или null', async () => {
    const t = makeSales({
      respond: sql => (sql.includes('FROM lead_events') ? [
        { id: 'e2', kind: 'comment', data: { text: 'Привет' }, createdAt: new Date('2026-11-15T09:00:00Z'), userId: MP.id, userName: MP.name },
        { id: 'e1', kind: 'created', data: null, createdAt: new Date('2026-11-14T09:00:00Z'), userId: null, userName: null },
      ] : []),
    });
    const list = await t.svc.events(LEAD_ID, MP2 as any);
    expect(list).toEqual([
      { id: 'e2', kind: 'comment', data: { text: 'Привет' }, createdAt: '2026-11-15T09:00:00.000Z', user: { id: MP.id, name: MP.name } },
      { id: 'e1', kind: 'created', data: null, createdAt: '2026-11-14T09:00:00.000Z', user: null },
    ]);
    expect(t.calls[0].sql).toContain('ORDER BY e.created_at DESC');
    expect(t.calls[0].sql).toContain('LIMIT 200');
  });

  it('комментарий возвращает запись ленты; пустой — 400', async () => {
    const t = makeSales({
      respond: sql => (sql.includes('RETURNING') ? [{ id: 'c1', kind: 'comment', data: { text: 'Перезвонит' }, createdAt: NOW }] : []),
    });
    const ev = await t.svc.addComment(LEAD_ID, { text: '  Перезвонит ' }, MP as any);
    expect(ev).toEqual({ id: 'c1', kind: 'comment', data: { text: 'Перезвонит' }, createdAt: NOW.toISOString(), user: { id: MP.id, name: MP.name } });
    await expect(t.svc.addComment(LEAD_ID, { text: '   ' }, MP as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('POST /sales/leads/:id/handoff', () => {
  const body = { direction: 'smm' as const, product: 'Тариф «Старт»', amount: 3500, firstPaymentAt: '2026-11-20', note: 'Нужен бриф', sendBrief: true };

  it('повторная передача — 409, этап и рассылка не трогаются', async () => {
    const t = makeSales({ lead: { handoffAt: new Date('2026-11-10T00:00:00Z') } });
    await expect(t.svc.handoff(LEAD_ID, body, MP as any)).rejects.toBeInstanceOf(ConflictException);
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
    expect(t.notifications.create).not.toHaveBeenCalled();
  });

  it('гонка: второй клик не занял передачу (UPDATE без строк) — 409', async () => {
    const t = makeSales({ respond: sql => (sql.includes('"handoffAt" IS NULL') ? [[], 0] : []) });
    await expect(t.svc.handoff(LEAD_ID, body, MP as any)).rejects.toBeInstanceOf(ConflictException);
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
  });

  it('передача: «Выиграно» через ClientsService, событие, задача руководителю на завтра, уведомления', async () => {
    const t = makeSales({
      lead: { status: 'contract', contactPhone: '+992 900' },
      respond: sql => (sql.includes('"handoffAt" IS NULL') ? [[{ id: LEAD_ID }], 1] : []),
      people: [FOUNDER, DIRECTOR, MP],
    });
    t.userRepo.find.mockImplementation(async (o: any) => {
      const where = Array.isArray(o?.where) ? o.where : [o?.where];
      // Поиск руководителя направления для задачи.
      if (where.some((w: any) => w?.role === 'smm_director' || w?.secondaryRole === 'smm_director') && where.length === 2) return [DIRECTOR];
      return [FOUNDER, DIRECTOR, MP];
    });
    await t.svc.handoff(LEAD_ID, body, MP as any);

    const claim = t.calls.find(c => c.sql.includes('"handoffAt" IS NULL'))!;
    expect(claim.params[0]).toBe(LEAD_ID);
    expect(claim.params[2]).toBe(MP.id);
    expect(JSON.parse(claim.params[3])).toEqual({
      direction: 'smm', product: 'Тариф «Старт»', amount: 3500, firstPaymentAt: '2026-11-20', note: 'Нужен бриф', sendBrief: true,
    });
    expect(t.clients.updateWithAuth).toHaveBeenCalledWith(LEAD_ID, { status: 'won' }, MP);
    expect(t.events().map(e => e.kind)).toEqual(['handoff']);

    const task = t.taskRepo.create.mock.calls[0][0];
    expect(task.title).toBe('Создать проект: Кафе «Сафо»');
    expect(task.assigneeId).toBe(DIRECTOR.id);
    expect(task.createdById).toBe(MP.id);
    expect(task.deadline).toEqual(new Date('2026-11-16T18:00:00+05:00'));
    expect(task.description).toContain('Тариф «Старт»');
    expect(task.description).toContain('+992 900');
    // id задачи — в данных передачи.
    expect(t.calls.some(c => c.sql.includes(`jsonb_build_object('taskId'`))).toBe(true);

    // Уведомления — основателю и руководителю, не самому менеджеру.
    const to = t.notifications.create.mock.calls.map((c: any[]) => c[0].userId).sort();
    expect(to).toEqual([DIRECTOR.id, FOUNDER.id].sort());
    expect(t.telegram.sendToUser).toHaveBeenCalledTimes(2);
    const directorNote = t.notifications.create.mock.calls.find((c: any[]) => c[0].userId === DIRECTOR.id)[0];
    expect(directorNote.link).toBe('/tasks/tttttttt-tttt-tttt-tttt-tttttttttttt');
  });

  it('лид уже выигран — этап повторно не ставим', async () => {
    const t = makeSales({ lead: { status: 'won' }, respond: sql => (sql.includes('"handoffAt" IS NULL') ? [[{ id: LEAD_ID }], 1] : []) });
    await t.svc.handoff(LEAD_ID, body, MP as any);
    expect(t.clients.updateWithAuth).not.toHaveBeenCalled();
  });

  it('ClientsService отказал в «Выиграно» — передача снимается, ошибка наружу', async () => {
    const t = makeSales({ respond: sql => (sql.includes('"handoffAt" IS NULL') ? [[{ id: LEAD_ID }], 1] : []) });
    t.clients.updateWithAuth.mockRejectedValueOnce(new ForbiddenException('нет'));
    await expect(t.svc.handoff(LEAD_ID, body, MP as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.calls.some(c => c.sql.includes('SET "handoffAt" = NULL'))).toBe(true);
    expect(t.taskRepo.save).not.toHaveBeenCalled();
  });
});

describe('POST /sales/handoffs/:leadId/link', () => {
  const PROJECT = 'pppppppp-pppp-pppp-pppp-pppppppppppp';
  const projectRow = (over: any = {}) => ({ id: PROJECT, name: 'Сафо SMM', leadId: null, projectType: 'SMM', salesManagerId: null, smmData: {}, ...over });

  it('только руководство', async () => {
    const t = makeSales();
    await expect(t.svc.linkProject(LEAD_ID, { projectId: PROJECT }, DIRECTOR as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('проект другого лида — 409', async () => {
    const t = makeSales({ respond: sql => (sql.includes('FROM projects WHERE id') ? [projectRow({ leadId: 'other' })] : []) });
    await expect(t.svc.linkProject(LEAD_ID, { projectId: PROJECT }, FOUNDER as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('связь: обе стороны, менеджер-продавец становится ответственным SMM-проекта, событие, уведомление', async () => {
    const t = makeSales({
      lead: { handoffById: MP.id, handoffData: { taskId: 'tttttttt-tttt-tttt-tttt-tttttttttttt' } },
      respond: sql => (sql.includes('FROM projects WHERE id') ? [projectRow()] : []),
    });
    t.taskRepo.findOne.mockResolvedValueOnce({ id: 't', status: 'new' });
    await t.svc.linkProject(LEAD_ID, { projectId: PROJECT }, FOUNDER as any);
    expect(t.calls.some(c => c.sql.includes('UPDATE client_leads SET "projectId"') && c.params[1] === PROJECT)).toBe(true);
    expect(t.calls.some(c => c.sql.includes('UPDATE projects SET "leadId" = $1') && c.params[0] === LEAD_ID)).toBe(true);
    const col = t.calls.find(c => c.sql.includes('SET "salesManagerId"'))!;
    expect(col.params).toEqual([PROJECT, MP.id]);
    const smm = t.calls.find(c => c.sql.includes('"smmData"') && c.sql.startsWith('UPDATE'))!;
    const set = JSON.parse(smm.params[0]);
    expect(set.salesManagerId).toBe(MP.id);
    expect(set.salesManagerHistory).toEqual([{ managerId: MP.id, from: '2026-11-15' }]);
    expect(t.events()).toEqual([{ kind: 'project_linked', data: { projectId: PROJECT, projectName: 'Сафо SMM' } }]);
    expect(t.taskRepo.update).toHaveBeenCalledWith('tttttttt-tttt-tttt-tttt-tttttttttttt', expect.objectContaining({ status: 'done' }));
    expect(t.notifications.create.mock.calls[0][0]).toMatchObject({ userId: MP.id, title: '✅ Проект создан', link: `/projects/${PROJECT}` });
  });

  it('ответственный уже назначен — не трогаем', async () => {
    const t = makeSales({
      respond: sql => (sql.includes('FROM projects WHERE id') ? [projectRow({ salesManagerId: MP2.id, smmData: { salesManagerId: MP2.id } })] : []),
    });
    await t.svc.linkProject(LEAD_ID, { projectId: PROJECT }, FOUNDER as any);
    expect(t.calls.some(c => c.sql.includes('SET "salesManagerId"'))).toBe(false);
    expect(t.calls.some(c => c.sql.includes('"smmData"') && c.sql.startsWith('UPDATE'))).toBe(false);
  });
});

describe('rowsOf', () => {
  it('UPDATE … RETURNING через manager.query — [rows, count]; INSERT — rows', () => {
    expect(rowsOf([[{ id: 1 }], 1])).toEqual([{ id: 1 }]);
    expect(rowsOf([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});
