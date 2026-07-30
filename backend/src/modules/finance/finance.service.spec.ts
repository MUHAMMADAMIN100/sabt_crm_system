import { FinanceService } from './finance.service';
import {
  FinanceTransaction,
  FinanceTxStatus,
  FinanceTxType,
} from './finance-transaction.entity';
import {
  salaryForFinanceMonth,
  workedInFinanceMonth,
} from './finance-calculations';

const emptyMaps = {
  accounts: [],
  categories: [],
  projects: [],
  employees: [],
  debts: [],
  acc: new Map(),
  cat: new Map(),
  proj: new Map(),
  emp: new Map(),
  debt: new Map(),
};

const repository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  create: jest.fn((value) => value),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
});

function transaction(
  overrides: Partial<FinanceTransaction>,
): FinanceTransaction {
  return {
    id: Math.random().toString(36),
    type: FinanceTxType.EXPENSE,
    amount: 0,
    date: '2026-07-01',
    status: FinanceTxStatus.COMPLETED,
    accountId: null,
    fromAccountId: null,
    toAccountId: null,
    categoryId: null,
    projectId: null,
    employeeId: null,
    debtId: null,
    subscriptionId: null,
    salaryYm: null,
    comment: null,
    ...overrides,
  } as FinanceTransaction;
}

describe('FinanceService correctness', () => {
  let service: FinanceService;
  let txRepo: ReturnType<typeof repository>;
  let accountRepo: ReturnType<typeof repository>;
  let subscriptionRepo: ReturnType<typeof repository>;
  let plannedPaymentRepo: ReturnType<typeof repository>;

  beforeEach(() => {
    txRepo = repository();
    accountRepo = repository();
    const categoryRepo = repository();
    const projectRepo = repository();
    const employeeRepo = repository();
    subscriptionRepo = repository();
    const debtRepo = repository();
    plannedPaymentRepo = repository();
    const assetRepo = repository();
    const backupRepo = repository();
    const forecastAdjustmentRepo = repository();
    const dataSource = {
      transaction: jest.fn(async (...args: any[]) => {
        const callback = args[args.length - 1];
        return callback({
          getRepository: (entity: any) =>
            entity?.name === 'FinanceTransaction' ? txRepo : plannedPaymentRepo,
        });
      }),
    };

    service = new FinanceService(
      txRepo as any,
      accountRepo as any,
      categoryRepo as any,
      projectRepo as any,
      employeeRepo as any,
      subscriptionRepo as any,
      debtRepo as any,
      plannedPaymentRepo as any,
      assetRepo as any,
      backupRepo as any,
      forecastAdjustmentRepo as any,
      dataSource as any,
      {} as any,
    );
  });

  it('subtracts only posted partial subscription payments from the monthly obligation', async () => {
    jest.spyOn(service as any, 'maps').mockResolvedValue(emptyMaps);
    jest.spyOn(service as any, 'salaryTxForMonth').mockResolvedValue([]);

    txRepo.find
      .mockResolvedValueOnce([
        transaction({ amount: 40, subscriptionId: 'sub-1' }),
        transaction({ amount: 60, subscriptionId: 'sub-1', status: FinanceTxStatus.PENDING }),
        transaction({ amount: 100, subscriptionId: 'sub-1', status: FinanceTxStatus.CANCELLED }),
      ])
      .mockResolvedValueOnce([]);
    subscriptionRepo.find.mockResolvedValue([{
      id: 'sub-1',
      name: 'Сервис',
      amount: 100,
      active: true,
      paidMarks: null,
    }]);
    plannedPaymentRepo.find.mockResolvedValue([]);

    const result = await service.expenseSummary('2026-07');

    expect(result.subscriptions).toMatchObject({
      monthly: 100,
      spent: 40,
      paidCount: 0,
      toPay: 60,
    });
  });

  it('uses the requested month for debt dueMonth', async () => {
    const debt = {
      id: 'debt-1',
      totalAmount: 500,
      paidBefore: 0,
      monthlyPayment: 100,
    };
    jest.spyOn(service as any, 'maps').mockResolvedValue({
      ...emptyMaps,
      debts: [debt],
      debt: new Map([[debt.id, debt]]),
    });
    jest.spyOn(service as any, 'salaryTxForMonth').mockResolvedValue([]);

    txRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    subscriptionRepo.find.mockResolvedValue([]);
    plannedPaymentRepo.find.mockResolvedValue([
      { id: 'june', debtId: debt.id, ym: '2026-06', amount: 75, status: 'expected' },
      { id: 'july', debtId: debt.id, ym: '2026-07', amount: 100, status: 'expected' },
    ]);

    const result = await service.expenseSummary('2026-06');

    expect(result.debts.dueMonth).toBe(75);
  });

  it('excludes future, pending and cancelled transactions from the current account balance', async () => {
    accountRepo.find.mockResolvedValue([{
      id: 'account-1',
      key: 'cash',
      name: 'Наличные',
      startBalance: 100,
      position: 0,
      createdAt: new Date('2020-01-01'),
    }]);
    txRepo.find.mockResolvedValue([
      transaction({ type: FinanceTxType.INCOME, amount: 50, accountId: 'account-1', date: '2000-01-01' }),
      transaction({ type: FinanceTxType.EXPENSE, amount: 10, accountId: 'account-1', date: '2000-01-02' }),
      transaction({ type: FinanceTxType.INCOME, amount: 20, accountId: 'account-1', date: '2000-01-03', status: null as any }),
      transaction({ type: FinanceTxType.INCOME, amount: 500, accountId: 'account-1', date: '2000-01-04', status: FinanceTxStatus.PENDING }),
      transaction({ type: FinanceTxType.INCOME, amount: 500, accountId: 'account-1', date: '2000-01-05', status: FinanceTxStatus.CANCELLED }),
      transaction({ type: FinanceTxType.INCOME, amount: 1000, accountId: 'account-1', date: '2999-01-01' }),
    ]);

    const result = await service.accountsBalances();

    expect(result.perAccount[0]).toMatchObject({
      income: 70,
      expense: 10,
      balance: 160,
    });
    expect(result.total.balance).toBe(160);
  });

  it('moves savings between accounts without changing the total balance', async () => {
    accountRepo.find.mockResolvedValue([
      {
        id: 'operating',
        key: 'operating',
        name: 'Рабочий',
        startBalance: 100,
        position: 0,
        createdAt: new Date('2020-01-01'),
      },
      {
        id: 'reserve',
        key: 'reserve',
        name: 'Резерв',
        startBalance: 0,
        position: 1,
        createdAt: new Date('2020-01-01'),
      },
    ]);
    txRepo.find.mockResolvedValue([
      transaction({
        type: FinanceTxType.SAVING,
        amount: 30,
        fromAccountId: 'operating',
        toAccountId: 'reserve',
        date: '2000-01-01',
      }),
    ]);

    const result = await service.accountsBalances();

    expect(result.perAccount[0]).toMatchObject({ balance: 70, transferOut: 30, saving: 0 });
    expect(result.perAccount[1]).toMatchObject({ balance: 30, transferIn: 30, saving: 30 });
    expect(result.total.balance).toBe(100);
    expect(result.total.income).toBe(0);
    expect(result.total.expense).toBe(0);
  });

  it('preserves the balance effect of legacy one-account savings', async () => {
    accountRepo.find.mockResolvedValue([{
      id: 'reserve',
      key: 'reserve',
      name: 'Резерв',
      startBalance: 10,
      position: 0,
      createdAt: new Date('2020-01-01'),
    }]);
    txRepo.find.mockResolvedValue([
      transaction({
        type: FinanceTxType.SAVING,
        amount: 25,
        accountId: 'reserve',
        date: '2000-01-01',
      }),
    ]);

    const result = await service.accountsBalances();

    expect(result.perAccount[0]).toMatchObject({ balance: 35, saving: 25 });
    expect(result.total.balance).toBe(35);
  });

  it('cancels a ledger transaction instead of deleting it', async () => {
    const row = transaction({ id: 'tx-1', amount: 25 });
    txRepo.findOne.mockResolvedValue(row);
    plannedPaymentRepo.find.mockResolvedValue([]);

    await service.removeTransaction(row.id);

    expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: row.id,
      status: FinanceTxStatus.CANCELLED,
    }));
    expect(txRepo.delete).not.toHaveBeenCalled();
  });

  it('normalizes legacy backup account keys before restore', () => {
    const normalized = (service as any).normalizeImportData({
      version: 1,
      accounts: [{ id: 'account-1', key: 'cash' }],
      categories: [],
      projects: [{ id: 'project-1', archived: true, status: 'active' }],
      employees: [{
        id: 'employee-1', status: 'inactive', salary: 5_000,
        hireDate: '2026-06-11',
      }],
      subscriptions: [],
      debts: [],
      transactions: [{ id: 'tx-1', account: 'cash', accountId: null }],
    });

    expect(normalized).toMatchObject({
      version: 2,
      transactions: [{ id: 'tx-1', accountId: 'account-1' }],
      projects: [{ id: 'project-1', archived: true, status: 'archived' }],
      employees: [{
        id: 'employee-1', status: 'fired',
        salaryHistory: { '2026-06': 5_000 },
      }],
      plannedPayments: [],
      assets: [],
      forecastAdjustments: [],
    });
  });

  it('rejects an unsupported backup version before restore', () => {
    expect(() => (service as any).normalizeImportData({ version: 99 }))
      .toThrow('Версия резервной копии 99 не поддерживается');
  });
});

describe('workedInFinanceMonth', () => {
  it('does not add an employee to months before hiring', () => {
    expect(workedInFinanceMonth({
      hireDate: '2026-07-24',
      status: 'active',
    }, '2026-06')).toBe(false);
    expect(workedInFinanceMonth({
      hireDate: '2026-07-24',
      status: 'active',
    }, '2026-07')).toBe(true);
  });

  it('keeps the termination month but excludes following months', () => {
    const employee = {
      hireDate: '2026-05-01',
      terminationDate: '2026-07-10',
      status: 'fired',
    };
    expect(workedInFinanceMonth(employee, '2026-07')).toBe(true);
    expect(workedInFinanceMonth(employee, '2026-08')).toBe(false);
  });

  it('shows a legacy fired employee only in a frozen historical month', () => {
    const employee = {
      hireDate: '2026-05-01',
      status: 'fired',
      salarySnapshots: { '2026-06': { paid: 5_000 } },
    };
    expect(workedInFinanceMonth(employee, '2026-06')).toBe(true);
    expect(workedInFinanceMonth(employee, '2026-07')).toBe(false);
  });

  it('does not fill the gap between two employment periods', () => {
    const employee = {
      hireDate: '2026-07-20',
      status: 'active',
      employmentHistory: [{
        hireDate: '2026-01-10',
        terminationDate: '2026-03-15',
      }],
    };
    expect(workedInFinanceMonth(employee, '2026-02')).toBe(true);
    expect(workedInFinanceMonth(employee, '2026-05')).toBe(false);
    expect(workedInFinanceMonth(employee, '2026-07')).toBe(true);
  });

  it('keeps a frozen legacy month visible after rehire', () => {
    const employee = {
      hireDate: '2026-07-20',
      status: 'active',
      salarySnapshots: { '2026-06': { paid: 5_000 } },
    };
    expect(workedInFinanceMonth(employee, '2026-06')).toBe(true);
  });
});

describe('salaryForFinanceMonth', () => {
  it('uses the latest rate effective in the selected month', () => {
    const employee = {
      salary: 7_000,
      salaryHistory: {
        '2026-01': 5_000,
        '2026-07': 7_000,
      },
    };
    expect(salaryForFinanceMonth(employee, '2026-06')).toBe(5_000);
    expect(salaryForFinanceMonth(employee, '2026-07')).toBe(7_000);
  });
});
