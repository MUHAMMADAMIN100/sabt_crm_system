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
