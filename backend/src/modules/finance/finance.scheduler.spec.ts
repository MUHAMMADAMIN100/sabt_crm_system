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
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('salaryYm'), { ym: '2026-10', from: '2026-10-11', to: '2026-11-10' });
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
