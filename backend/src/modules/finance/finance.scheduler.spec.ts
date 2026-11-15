import { FinanceScheduler } from './finance.scheduler';
import {
  FinanceTransaction,
  FinanceTxStatus,
  FinanceTxType,
} from './finance-transaction.entity';

function payment(
  amount: number,
  status = FinanceTxStatus.COMPLETED,
): FinanceTransaction {
  return {
    id: `${status}-${amount}`,
    type: FinanceTxType.EXPENSE,
    amount,
    date: '2026-07-20',
    status,
    subscriptionId: 'sub-1',
  } as FinanceTransaction;
}

describe('FinanceScheduler subscription reminders', () => {
  let scheduler: FinanceScheduler;
  let subscriptionRepo: { find: jest.Mock };
  let transactionRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };

  beforeEach(() => {
    subscriptionRepo = {
      find: jest.fn().mockResolvedValue([{
        id: 'sub-1',
        name: 'Сервис',
        amount: 100,
        active: true,
        dueDay: 25,
        paidMarks: null,
      }]),
    };
    transactionRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    scheduler = new FinanceScheduler(
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      subscriptionRepo as any,
      { find: jest.fn() } as any,
      transactionRepo as any,
      { find: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  it('keeps reminding for the posted remaining amount and ignores pending/cancelled payments', async () => {
    transactionRepo.find.mockResolvedValue([
      payment(40),
      payment(60, FinanceTxStatus.PENDING),
      payment(100, FinanceTxStatus.CANCELLED),
    ]);
    const notify = jest.spyOn(scheduler, 'notifyFinanceUsers').mockResolvedValue(1);

    const result = await (scheduler as any).checkSubscriptionsDue('2026-07-30');

    expect(result).toEqual({ due: 1, notified: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('осталось 60'),
    }));
  });

  it('does not remind after the full amount is posted', async () => {
    transactionRepo.find.mockResolvedValue([payment(100)]);
    const notify = jest.spyOn(scheduler, 'notifyFinanceUsers').mockResolvedValue(1);

    const result = await (scheduler as any).checkSubscriptionsDue('2026-07-30');

    expect(result).toEqual({ due: 0, notified: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('FinanceScheduler: срок подписки и напоминание о зарплате (14.11.2026)', () => {
  const build = (repos: { subs?: any[]; emps?: any[]; txQb?: any }) => {
    const qb: any = {
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(repos.txQb ?? []),
    };
    const txRepo = { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn(() => qb) };
    const scheduler = new FinanceScheduler(
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue(repos.subs ?? []) } as any,
      { find: jest.fn().mockResolvedValue(repos.emps ?? []) } as any,
      txRepo as any,
      { find: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    return { scheduler, qb };
  };

  it('не напоминает о закончившейся и ещё не начавшейся подписке', async () => {
    const { scheduler } = build({ subs: [
      { id: 'ended', name: 'Старый сервер', amount: 100, active: true, dueDay: 5, endDate: '2026-09-30' },
      { id: 'future', name: 'Новая аренда', amount: 500, active: true, dueDay: 5, dueDate: '2026-12-05' },
      { id: 'ends-before-due', name: 'До 3-го', amount: 50, active: true, dueDay: 20, endDate: '2026-11-03' },
      { id: 'live', name: 'Аренда', amount: 300, active: true, dueDay: 5 },
    ] });
    const notify = jest.spyOn(scheduler, 'notifyFinanceUsers').mockResolvedValue(1);
    const result = await (scheduler as any).checkSubscriptionsDue('2026-11-14');
    expect(result).toEqual({ due: 1, notified: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Аренда') }));
  });

  it('10 ноября напоминает про октябрьскую зарплату, «Премия» в выплаты не входит', async () => {
    const emp = {
      id: 'e1', name: 'Бехруз', salary: 5000, salaryHistory: { '2026-01': 5000 }, hireDate: '2026-01-10',
      terminationDate: null, status: 'active', employmentHistory: null, salarySnapshots: null,
      bonuses: null, fines: null, vacations: null,
    };
    const { scheduler, qb } = build({
      emps: [emp],
      txQb: [
        { employeeId: 'e1', amount: 3000, comment: 'Аванс', date: '2026-10-25', salaryYm: '2026-10' },
        { employeeId: 'e1', amount: 500, comment: 'Премия — за съёмку', date: '2026-11-05', salaryYm: '2026-10' },
      ],
    });
    const notify = jest.spyOn(scheduler, 'notifyFinanceUsers').mockResolvedValue(1);
    const result = await (scheduler as any).checkSalaryDue('2026-11-10');
    expect(result).toEqual({ due: 1, notified: 1 });
    // Старые строки без salaryYm — по календарному месяцу, как в ведомости (15.11.2026).
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('salaryYm'), { ym: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Зарплата за октябрь не выплачена полностью',
      message: expect.stringContaining('К выплате осталось 2'),
      alertKey: 'fin-salary:2026-10:10',
    }));
  });

  it('октябрь выплачен — 15 ноября не напоминает', async () => {
    const emp = {
      id: 'e1', name: 'Бехруз', salary: 5000, salaryHistory: { '2026-01': 5000 }, hireDate: '2026-01-10',
      terminationDate: null, status: 'active', employmentHistory: null, salarySnapshots: null,
    };
    const { scheduler } = build({
      emps: [emp],
      txQb: [{ employeeId: 'e1', amount: 5000, comment: 'Зарплата', date: '2026-11-10', salaryYm: '2026-10' }],
    });
    const notify = jest.spyOn(scheduler, 'notifyFinanceUsers').mockResolvedValue(1);
    expect(await (scheduler as any).checkSalaryDue('2026-11-15')).toEqual({ due: 0, notified: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('FinanceScheduler: Telegram-текст экранируется (15.11.2026)', () => {
  it('название проекта с «<» и «&» уходит в Telegram экранированным', async () => {
    const sendToUser = jest.fn().mockResolvedValue(undefined);
    const scheduler = new FinanceScheduler(
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue([{ id: 'boss', role: 'founder', isActive: true, isBlocked: false }]) } as any,
      { createIfNotRecent: jest.fn().mockResolvedValue(true) } as any,
      { sendToUser } as any,
    );
    await scheduler.notifyFinanceUsers({ title: 'Оплата <b>', message: 'ООО «A&B» <script>', alertKey: 'k' });
    expect(sendToUser).toHaveBeenCalledWith('boss', '💰 <b>Оплата &lt;b&gt;</b>\nООО «A&amp;B» &lt;script&gt;');
  });
});

describe('FinanceScheduler: напоминание ответственному менеджеру (14.11.2026)', () => {
  const TODAY = '2026-11-14';
  const fin = (over: any) => ({ archived: false, status: 'active', tariff: 4000, salesManagerId: null, salesManagerHistory: null, ...over });
  const build = (expected: any[]) => {
    const finProjects = [
      fin({ id: 'f-smm', name: 'Chrono', direction: 'smm' }),
      fin({ id: 'f-dev', name: 'Сайт Alif', direction: 'development', salesManagerId: 'mgr-dev' }),
      fin({ id: 'f-boss', name: 'Сайт владельца', direction: 'maintenance', salesManagerId: 'boss' }),
    ];
    const crm = [{ id: 'crm-1', name: 'Chrono', smmData: { salesManagerId: 'mgr-smm' }, isArchived: false, status: 'active' }];
    const users = [
      { id: 'mgr-smm', role: 'sales_manager_smm', isActive: true, isBlocked: false },
      { id: 'mgr-dev', role: 'sales_manager_dev', isActive: true, isBlocked: false },
      { id: 'boss', role: 'founder', isActive: true, isBlocked: false },
    ];
    const created: any[] = [];
    const scheduler = new FinanceScheduler(
      { find: jest.fn().mockResolvedValue(expected) } as any,
      { find: jest.fn().mockResolvedValue(finProjects), manager: { query: jest.fn().mockResolvedValue(crm) } } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn() } as any,
      { find: jest.fn().mockResolvedValue(users) } as any,
      { createIfNotRecent: jest.fn(async (dto: any) => { created.push(dto); return true; }) } as any,
      { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
    );
    return { scheduler, created };
  };
  const pp = (id: string, projectId: string, dueDate: string) => ({ id, projectId, dueDate, status: 'expected', partNo: 1, amount: 4000, ym: dueDate.slice(0, 7) });

  it('накануне — менеджеру SMM-проекта со ссылкой на проект, в день срока — менеджеру разработки на «Панель»', async () => {
    const { scheduler, created } = build([pp('a', 'f-smm', '2026-11-15'), pp('b', 'f-dev', TODAY)]);
    await (scheduler as any).checkProjectPayments(TODAY);
    const toMgr = created.filter(n => n.userId !== 'boss');
    expect(toMgr.map(n => [n.userId, n.title, n.link])).toEqual([
      ['mgr-smm', 'Завтра клиент должен оплатить', '/smm/projects/crm-1'],
      ['mgr-dev', 'Сегодня клиент должен оплатить', '/'],
    ]);
    expect(toMgr[0].message).toContain('Chrono');
  });

  it('за 3 дня менеджеру не пишем; просроченное — утренним списком (15.11.2026)', async () => {
    const { scheduler, created } = build([pp('a', 'f-smm', '2026-11-17'), pp('b', 'f-dev', '2026-11-10')]);
    await (scheduler as any).checkProjectPayments(TODAY);
    expect(created.map(n => n.userId)).toEqual(['boss', 'boss', 'mgr-dev']);
    const late = created[2];
    expect(late.title).toBe('Просрочены оплаты клиентов: 1');
    expect(late.message).toContain('Сайт Alif: 4');
    expect(late.message).toContain('просрочено на 4 дн.');
    expect(late.data.alertKey).toBe('fin-pp-mgr-late:mgr-dev:2026-11-14');
    expect(late.link).toBe('/');
  });

  it('просроченные оплаты своих клиентов — одно сообщение, самые давние первыми, до 5 строк', async () => {
    const days = ['2026-11-13', '2026-11-01', '2026-11-12', '2026-11-05', '2026-11-11', '2026-11-08', '2026-11-09'];
    const { scheduler, created } = build(days.map((d, i) => pp(`s${i}`, 'f-smm', d)));
    await (scheduler as any).checkProjectPayments(TODAY);
    const toMgr = created.filter(n => n.userId === 'mgr-smm');
    expect(toMgr).toHaveLength(1);
    expect(toMgr[0].title).toBe('Просрочены оплаты клиентов: 7');
    const lines = String(toMgr[0].message).split('\n');
    expect(lines.slice(0, 5).map(l => /на (\d+) дн/.exec(l)?.[1])).toEqual(['13', '9', '6', '5', '3']);
    expect(lines[5]).toBe('…и ещё 2');
    expect(lines[6]).toContain('Напомните клиентам');
    // Все просрочки у одного клиента — ссылка сразу на его проект.
    expect(toMgr[0].link).toBe('/smm/projects/crm-1');
  });

  it('владельцу с «Финансами» списка просрочек не шлём — он уже получил напоминания', async () => {
    const { scheduler, created } = build([pp('c', 'f-boss', '2026-11-10')]);
    await (scheduler as any).checkProjectPayments(TODAY);
    expect(created.map(n => n.userId)).toEqual(['boss']);
  });

  it('у менеджера есть «Финансы» — второе напоминание не шлём', async () => {
    const { scheduler, created } = build([pp('c', 'f-boss', TODAY)]);
    await (scheduler as any).checkProjectPayments(TODAY);
    expect(created.map(n => n.userId)).toEqual(['boss']);
  });
});
