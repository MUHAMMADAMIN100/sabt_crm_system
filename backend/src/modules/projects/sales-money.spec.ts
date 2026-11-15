import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

/** «Продажи, этап 2» (15.11.2026, SALES_SPEC §6): деньги проекта менеджер
 *  продаж видит только у своих клиентов, запрос оплаты считает долг по
 *  «Финансам», проект по заявке продаж связывается с лидом. */

const P1 = '11111111-1111-4111-8111-111111111111';
const L1 = '22222222-2222-4222-8222-222222222222';

const project = (over: Record<string, any> = {}) => ({
  id: 'p', name: 'Chrono', projectType: 'SMM', smmData: {},
  paidAmount: 100, budget: 200, totalContractValue: 300, outstandingAmount: 50, monthlyFee: 40,
  marginEstimate: 7, internalCostEstimate: 9,
  customTariff: { monthlyPrice: 900, reelsPerMonth: 4 },
  ...over,
});

function bare() {
  const svc: any = Object.create(ProjectsService.prototype);
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  svc.FINANCE_FIELDS = [];
  return svc;
}

describe('stripFinance — суммы только своих проектов', () => {
  it('МП видит суммы у своих проектов (smmData или колонка), у чужих — нет', () => {
    const svc = bare();
    const [own1, own2, other] = svc.stripFinance([
      project({ id: 'a', smmData: { salesManagerId: 'm1' } }),
      project({ id: 'b', salesManagerId: 'm1' }),
      project({ id: 'c', smmData: { salesManagerId: 'm2' } }),
    ], { id: 'm1', role: 'sales_manager_smm' });
    for (const p of [own1, own2]) {
      expect(p).toMatchObject({ paidAmount: 100, budget: 200, totalContractValue: 300, monthlyFee: 40 });
      expect(p.customTariff.monthlyPrice).toBe(900);
    }
    for (const k of ['paidAmount', 'budget', 'totalContractValue', 'outstandingAmount', 'monthlyFee']) {
      expect(other).not.toHaveProperty(k);
    }
    expect(other.customTariff).toEqual({ reelsPerMonth: 4 });
    // Маржа — никому, кроме основателя.
    for (const p of [own1, own2, other]) expect(p).not.toHaveProperty('marginEstimate');
  });

  it('МП второй ролью — то же правило', () => {
    const svc = bare();
    const viewer = { id: 'm1', role: 'smm_specialist', secondaryRole: 'sales_manager_dev' };
    const [own, other] = svc.stripFinance([
      project({ id: 'a', salesManagerId: 'm1' }), project({ id: 'b' }),
    ], viewer);
    expect(own.paidAmount).toBe(100);
    expect(other).not.toHaveProperty('paidAmount');
  });

  it('по одной роли «свой» не определить — суммы МП не отдаём; основатель видит всё', () => {
    const svc = bare();
    const stripped = svc.stripFinance(project({ smmData: { salesManagerId: 'm1' } }), 'sales_manager_smm');
    expect(stripped).not.toHaveProperty('paidAmount');
    const full = svc.stripFinance(project(), { id: 'f', role: 'founder' });
    expect(full).toMatchObject({ paidAmount: 100, marginEstimate: 7 });
  });

  it('руководитель направления — только budget', () => {
    const svc = bare();
    const p = svc.stripFinance(project(), { id: 'd', role: 'smm_director' });
    expect(p.budget).toBe(200);
    expect(p).not.toHaveProperty('paidAmount');
  });
});

describe('Оплаты проекта — только свой клиент', () => {
  const make = (p: any) => {
    const svc = bare();
    svc.repo = { findOne: jest.fn(async () => p) };
    svc.paymentRepo = { find: jest.fn(async () => [{ id: 'x', amount: '500', paidAt: '2026-11-01', note: null, createdAt: null }]) };
    return svc as ProjectsService;
  };

  it('МП: свой проект — список, чужой того же направления — 403', async () => {
    const svc = make(project({ smmData: { salesManagerId: 'm1' } }));
    await expect(svc.listPayments('p', { id: 'm1', role: 'sales_manager_smm' })).resolves.toHaveLength(1);
    await expect(svc.listPayments('p', { id: 'm2', role: 'sales_manager_smm' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('МП разработки больше не видит оплаты чужого проекта разработки', async () => {
    const svc = make(project({ projectType: 'Лендинг', salesManagerId: 'other' }));
    await expect(svc.listPayments('p', { id: 'd1', role: 'sales_manager_dev' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('руководитель разработки второй ролью — всё своё направление', async () => {
    const svc = make(project({ projectType: 'Лендинг', salesManagerId: 'other' }));
    await expect(svc.listPayments('p', { id: 's', role: 'sales_manager_dev', secondaryRole: 'dev_director' }))
      .resolves.toHaveLength(1);
  });
});

describe('Запрос оплаты — долг из «Финансов»', () => {
  const make = (debt: any) => {
    const svc = bare();
    svc.repo = {
      findOne: jest.fn(async () => project({
        id: P1, smmData: { salesManagerId: 'm1' }, clientInfo: { email: 'c@client.tj', contactPerson: 'Нигора' },
        totalContractValue: 99999, budget: 99999, paidAmount: 0,
      })),
    };
    svc.smmPayments = { projectDebt: jest.fn(async () => debt) };
    svc.mailService = { sendPaymentRequestToClient: jest.fn(async () => true) };
    svc.activityLog = { log: jest.fn(async () => undefined) };
    return svc;
  };
  const MP = { id: 'm1', name: 'Фарух', role: 'sales_manager_smm' };

  it('сумма письма — по «Финансам», а не по полям проекта', async () => {
    const svc = make({ client: { id: 'f1', name: 'Chrono', by: 'manual' }, total: 4000, paid: 2000, remaining: 2000, items: [] });
    const res = await svc.sendPaymentRequest(P1, MP);
    expect(svc.mailService.sendPaymentRequestToClient)
      .toHaveBeenCalledWith('c@client.tj', 'Нигора', 'Chrono', 4000, 2000, 2000, 'Фарух', undefined);
    expect(res).toEqual({ sent: true, to: 'c@client.tj', remaining: 2000, total: 4000, paid: 2000 });
  });

  it('проект не связан с «Финансами» — 400 с понятным текстом, письмо не уходит', async () => {
    const svc = make(null);
    const err = await svc.sendPaymentRequest(P1, MP).catch((e: any) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('не связан с клиентом в «Финансах»');
    expect(svc.mailService.sendPaymentRequestToClient).not.toHaveBeenCalled();
  });

  it('долга нет — 400', async () => {
    const svc = make({ client: { id: 'f1', name: 'Chrono', by: 'name' }, total: 4000, paid: 4000, remaining: 0, items: [] });
    await expect(svc.sendPaymentRequest(P1, MP)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('чужой клиент — 403, «Финансы» даже не читаем', async () => {
    const svc = make(null);
    await expect(svc.sendPaymentRequest(P1, { ...MP, id: 'm2' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.smmPayments.projectDebt).not.toHaveBeenCalled();
  });
});

describe('Проект по заявке продаж — связь с лидом', () => {
  function make(lead: any | null, updateResult: any = [[{ id: L1 }], 1]) {
    const svc = bare();
    svc.validateManagerAssignment = jest.fn(async () => undefined);
    svc.recomputeFinancials = jest.fn(async () => undefined);
    svc.generateContentPlanFromTariff = jest.fn(async () => undefined);
    const queries: Array<{ sql: string; params: any[] }> = [];
    svc.repo = {
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (x: any) => ({ ...x, id: P1 })),
      manager: {
        query: jest.fn(async (sql: string, params: any[] = []) => {
          queries.push({ sql, params });
          if (/FROM client_leads cl/.test(sql)) return lead ? [lead] : [];
          if (/UPDATE client_leads/.test(sql)) return updateResult;
          return [];
        }),
      },
    };
    svc.userRepo = { findOne: jest.fn(async () => ({ id: 'boss', name: 'Босс' })) };
    svc.notificationsService = { create: jest.fn(async () => ({})), createIfNotRecent: jest.fn(async () => true) };
    svc.telegramService = { sendToUser: jest.fn(async () => undefined), appUrl: 'https://crm.test' };
    svc.activityLog = { log: jest.fn(async () => undefined) };
    svc.gateway = { broadcast: jest.fn() };
    return { svc, queries };
  }
  const LEAD = {
    id: L1, name: 'Кафе «Сафо»', ownerId: 'owner1', projectId: null, projectName: null,
    ownerRole: 'sales_manager_dev', ownerSecondaryRole: null, ownerActive: true,
  };
  const dto = () => ({ name: 'Сафо — сайт', projectType: 'Лендинг', leadId: L1 } as any);

  it('проект получает leadId, лид — projectId, событие и уведомление менеджеру', async () => {
    const { svc, queries } = make(LEAD);
    await svc.create(dto(), 'boss', 'founder', null);
    expect(svc.repo.create).toHaveBeenCalledWith(expect.objectContaining({ leadId: L1 }));
    const upd = queries.find(q => /UPDATE client_leads/.test(q.sql));
    expect(upd?.params).toEqual([P1, L1]);
    const ev = queries.find(q => /INSERT INTO lead_events/.test(q.sql));
    expect(ev?.params.slice(0, 3)).toEqual([L1, 'boss', 'project_linked']);
    expect(JSON.parse(ev?.params[3])).toEqual({ projectId: P1, projectName: 'Сафо — сайт' });
    expect(svc.notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner1', title: 'Проект создан', message: 'Проект создан: Сафо — сайт', link: `/projects/${P1}`,
    }));
    expect(svc.telegramService.sendToUser).toHaveBeenCalledWith('owner1', expect.stringContaining('Проект создан: Сафо — сайт'));
  });

  it('руководитель направления тоже связывает; лид удалённого проекта снова свободен', async () => {
    const { svc } = make({ ...LEAD, projectId: 'gone', projectName: null });
    await expect(svc.create(dto(), 'dd', 'dev_director', null)).resolves.toBeTruthy();
  });

  it('лид уже связан с живым проектом — 409, проект не создаётся', async () => {
    const { svc } = make({ ...LEAD, projectId: 'x', projectName: 'Старый' });
    await expect(svc.create(dto(), 'boss', 'founder', null)).rejects.toBeInstanceOf(ConflictException);
    expect(svc.repo.save).not.toHaveBeenCalled();
  });

  it('лида нет — 404; связывать не руководству — 403', async () => {
    await expect(make(null).svc.create(dto(), 'boss', 'founder', null)).rejects.toBeInstanceOf(NotFoundException);
    const { svc } = make(LEAD);
    await expect(svc.create({ ...dto(), projectType: 'SMM', allowNoTariff: true }, 's1', 'smm_specialist', null))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.repo.save).not.toHaveBeenCalled();
  });

  it('менеджер не выбран — ответственным становится владелец лида', async () => {
    const { svc } = make(LEAD);
    await svc.create(dto(), 'boss', 'founder', null);
    expect(svc.repo.create).toHaveBeenCalledWith(expect.objectContaining({ salesManagerId: 'owner1' }));
  });

  it('SMM-проект по заявке — владелец лида и в smmData, с историей назначений', async () => {
    const { svc } = make({ ...LEAD, ownerRole: 'smm_specialist', ownerSecondaryRole: 'sales_manager_smm' });
    await svc.create({ name: 'Сафо SMM', projectType: 'SMM', allowNoTariff: true, leadId: L1 } as any, 'dir', 'smm_director', null);
    const saved = svc.repo.save.mock.calls[0][0];
    expect(saved.salesManagerId).toBe('owner1');
    expect(saved.smmData.salesManagerId).toBe('owner1');
    expect(saved.smmData.salesManagerHistory).toEqual([{ managerId: 'owner1', from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
  });

  it('выбранный менеджер важнее владельца лида; владелец не из продаж — не назначаем', async () => {
    const chosen = make(LEAD);
    await chosen.svc.create({ ...dto(), salesManagerId: 'm9' }, 'boss', 'founder', null);
    expect(chosen.svc.repo.create).toHaveBeenCalledWith(expect.objectContaining({ salesManagerId: 'm9' }));
    const notSales = make({ ...LEAD, ownerRole: 'founder' });
    await notSales.svc.create(dto(), 'boss', 'founder', null);
    expect(notSales.svc.repo.create.mock.calls[0][0].salesManagerId).toBeUndefined();
  });

  it('без leadId — ни запросов к лидам, ни уведомлений', async () => {
    const { svc, queries } = make(LEAD);
    await svc.create({ name: 'Без лида', projectType: 'Лендинг' } as any, 'boss', 'founder', null);
    expect(queries.some(q => /client_leads|lead_events/.test(q.sql))).toBe(false);
    expect(svc.notificationsService.create).not.toHaveBeenCalled();
  });
});
