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
import {
  NOTION_CONFIRMED_SALARY_HISTORY,
  NOTION_PAYROLL_HISTORY,
} from './notion-snapshot.data';
import {
  NOTION_HISTORY_TOTALS,
  NOTION_HISTORY_TRANSACTIONS,
} from './notion-history.data';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceDebt } from './entities/finance-debt.entity';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { FinanceAsset } from './entities/finance-asset.entity';
import { FinanceBackup } from './entities/finance-backup.entity';
import { FinanceForecastAdjustment } from './entities/finance-forecast-adjustment.entity';
import { FinanceActivity } from './entities/finance-activity.entity';
import { FinancePayrollPeriod } from './entities/finance-payroll-period.entity';

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
    source: null,
    externalId: null,
    affectsBalance: true,
    ...overrides,
  } as FinanceTransaction;
}

describe('FinanceService correctness', () => {
  let service: FinanceService;
  let txRepo: ReturnType<typeof repository>;
  let accountRepo: ReturnType<typeof repository>;
  let categoryRepo: ReturnType<typeof repository>;
  let projectRepo: ReturnType<typeof repository>;
  let employeeRepo: ReturnType<typeof repository>;
  let subscriptionRepo: ReturnType<typeof repository>;
  let debtRepo: ReturnType<typeof repository>;
  let plannedPaymentRepo: ReturnType<typeof repository>;
  let assetRepo: ReturnType<typeof repository>;
  let backupRepo: ReturnType<typeof repository>;
  let forecastAdjustmentRepo: ReturnType<typeof repository>;
  let activityRepo: ReturnType<typeof repository>;
  let payrollPeriodRepo: ReturnType<typeof repository>;
  let dataSource: { transaction: jest.Mock };
  let managerQuery: jest.Mock;

  beforeEach(() => {
    txRepo = repository();
    accountRepo = repository();
    categoryRepo = repository();
    projectRepo = repository();
    employeeRepo = repository();
    subscriptionRepo = repository();
    debtRepo = repository();
    plannedPaymentRepo = repository();
    assetRepo = repository();
    backupRepo = repository();
    forecastAdjustmentRepo = repository();
    activityRepo = repository();
    payrollPeriodRepo = repository();
    payrollPeriodRepo.findOne.mockImplementation(async (options: any) => {
      const ym = options?.where?.ym;
      const status = options?.where?.status;
      if (status === 'open') return null;
      return ym ? {
        ym, status: 'open', closedAt: null, closedById: null, reopenedAt: null,
      } : null;
    });
    payrollPeriodRepo.save.mockImplementation(async (value: any) => value);
    managerQuery = jest.fn().mockResolvedValue([]);
    dataSource = {
      transaction: jest.fn(async (...args: any[]) => {
        const callback = args[args.length - 1];
        return callback({
          query: managerQuery,
          getRepository: (entity: any) => {
            const repos = new Map<any, any>([
              [FinanceTransaction, txRepo],
              [FinanceAccount, accountRepo],
              [FinanceCategory, categoryRepo],
              [FinanceProject, projectRepo],
              [FinanceEmployee, employeeRepo],
              [FinanceSubscription, subscriptionRepo],
              [FinanceDebt, debtRepo],
              [FinancePlannedPayment, plannedPaymentRepo],
              [FinanceAsset, assetRepo],
              [FinanceBackup, backupRepo],
              [FinanceForecastAdjustment, forecastAdjustmentRepo],
              [FinanceActivity, activityRepo],
              [FinancePayrollPeriod, payrollPeriodRepo],
            ]);
            return repos.get(entity);
          },
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
      payrollPeriodRepo as any,
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
      transaction({
        type: FinanceTxType.INCOME,
        amount: 9_000,
        accountId: 'account-1',
        date: '1999-01-01',
        source: 'notion',
        externalId: 'historical-income',
        affectsBalance: false,
      }),
      transaction({
        type: FinanceTxType.EXPENSE,
        amount: 8_000,
        accountId: 'account-1',
        date: '1999-01-02',
        source: 'notion',
        externalId: 'historical-expense',
        affectsBalance: false,
      }),
    ]);

    const result = await service.accountsBalances();

    expect(result.perAccount[0]).toMatchObject({
      income: 70,
      expense: 10,
      balance: 160,
    });
    expect(result.total.balance).toBe(160);
  });

  it('rejects a new salary payment in a globally closed payroll period', async () => {
    payrollPeriodRepo.findOne.mockResolvedValue({
      ym: '2026-07', status: 'closed', closedAt: new Date(), closedById: 'owner',
      reopenedAt: null,
    });

    await expect(service.createOperation({
      type: FinanceTxType.EXPENSE,
      amount: 500,
      date: '2026-08-10',
      salaryYm: '2026-07',
      accountId: 'account-1',
      employeeId: 'employee-1',
    })).rejects.toThrow('Зарплатный период 2026-07 закрыт');

    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('rejects payroll field edits in a globally closed period', async () => {
    payrollPeriodRepo.findOne.mockResolvedValue({
      ym: '2026-07', status: 'closed', closedAt: new Date(), closedById: 'owner',
      reopenedAt: null,
    });
    employeeRepo.findOne.mockResolvedValue({ id: 'employee-1', salarySnapshots: null });

    await expect(service.setEmployeeFine('employee-1', {
      ym: '2026-07', amount: 100,
    })).rejects.toThrow('Зарплатный период 2026-07 закрыт');
  });

  it('rejects editing and cancelling a salary transaction in a closed period', async () => {
    payrollPeriodRepo.findOne.mockResolvedValue({
      ym: '2026-07', status: 'closed', closedAt: new Date(), closedById: 'owner',
      reopenedAt: null,
    });
    const salaryTx = transaction({
      id: 'salary-closed', employeeId: 'employee-1', salaryYm: '2026-07',
      accountId: 'account-1', amount: 500,
    });
    txRepo.findOne.mockResolvedValue(salaryTx);

    await expect(service.updateTransaction(salaryTx.id, { amount: 600 }))
      .rejects.toThrow('Зарплатный период 2026-07 закрыт');
    await expect(service.removeTransaction(salaryTx.id))
      .rejects.toThrow('Зарплатный период 2026-07 закрыт');

    expect(txRepo.update).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('keeps the previous month primary after the 10th until it is closed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T07:00:00Z'));
    try {
      payrollPeriodRepo.findOne.mockImplementation(async (options: any) => {
        if (options?.where?.ym === '2026-07') return {
          ym: '2026-07', status: 'open', closedAt: null,
          closedById: null, reopenedAt: null,
        };
        if (options?.where?.ym === '2026-08') return {
          ym: '2026-08', status: 'open', closedAt: null,
          closedById: null, reopenedAt: null,
        };
        return null;
      });

      await expect(service.salaryPeriodState()).resolves.toMatchObject({
        ym: '2026-07', status: 'open', latestOpenYm: '2026-07',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('makes the current month primary after the previous month is closed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T07:00:00Z'));
    try {
      payrollPeriodRepo.findOne.mockImplementation(async (options: any) => {
        if (options?.where?.ym === '2026-07') return {
          ym: '2026-07', status: 'closed', closedAt: new Date('2026-08-10'),
          closedById: 'owner', reopenedAt: null,
        };
        if (options?.where?.ym === '2026-08') return {
          ym: '2026-08', status: 'open', closedAt: null, closedById: null, reopenedAt: null,
        };
        return null;
      });

      await expect(service.salaryPeriodState('2026-07')).resolves.toMatchObject({
        ym: '2026-07', status: 'closed', latestOpenYm: '2026-08',
      });
    } finally {
      jest.useRealTimers();
    }
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

  it('imports only missing pre-cutover Notion rows and creates one safety snapshot', async () => {
    const rows = [
      {
        externalId: 'already-there',
        date: '2026-05-01',
        type: 'income',
        amount: 100,
        accountKey: 'cash',
        fromKey: null,
        toKey: null,
        categoryKey: 'smm',
        name: 'Существующая строка',
        comment: '',
      },
      {
        externalId: 'new-row',
        date: '2026-05-02',
        type: 'expense',
        amount: 25,
        accountKey: 'cash',
        fromKey: null,
        toKey: null,
        categoryKey: 'other_expense',
        name: 'Покупка',
        comment: 'для офиса',
      },
      {
        externalId: 'after-cutover',
        date: '2026-06-01',
        type: 'expense',
        amount: 999,
        accountKey: 'cash',
        fromKey: null,
        toKey: null,
        categoryKey: 'other_expense',
        name: 'Не импортировать',
        comment: '',
      },
    ] as any;
    const existing = transaction({
      id: 'existing-id',
      type: FinanceTxType.INCOME,
      amount: 100,
      date: '2026-05-01',
      accountId: 'cash-id',
      categoryId: 'smm-id',
      source: 'notion',
      externalId: 'already-there',
      affectsBalance: false,
    });
    txRepo.find
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([
        existing,
        transaction({
          id: 'new-id',
          type: FinanceTxType.EXPENSE,
          amount: 25,
          date: '2026-05-02',
          accountId: 'cash-id',
          categoryId: 'other-expense-id',
          source: 'notion',
          externalId: 'new-row',
          affectsBalance: false,
        }),
      ]);
    accountRepo.find.mockResolvedValue([{ id: 'cash-id', key: 'cash', name: 'Cash' }]);
    categoryRepo.find.mockResolvedValue([
      { id: 'smm-id', key: 'smm', name: 'SMM', type: 'income' },
      { id: 'other-expense-id', key: null, name: 'Прочее', type: 'expense' },
    ]);
    txRepo.save.mockResolvedValue([]);
    activityRepo.save.mockImplementation(async value => value);
    jest.spyOn(service as any, 'exportAllWithManager').mockResolvedValue({ version: 2 });
    const backupSpy = jest.spyOn(service as any, 'saveBackupWithManager')
      .mockResolvedValue({ id: 'backup-1' });

    const first = await (service as any).importNotionHistoricalTransactions(rows);
    const second = await (service as any).importNotionHistoricalTransactions(rows);

    expect(first).toMatchObject({
      imported: 1,
      alreadyPresent: 1,
      cutoffRejected: 1,
      safetyBackupId: 'backup-1',
    });
    expect(second).toMatchObject({
      imported: 0,
      alreadyPresent: 2,
      cutoffRejected: 1,
      safetyBackupId: null,
    });
    expect(backupSpy).toHaveBeenCalledTimes(1);
    expect(managerQuery).toHaveBeenCalledTimes(2);
    expect(managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      [20_260_201],
    );
    expect(txRepo.save).toHaveBeenCalledTimes(1);
    const importedRows = txRepo.save.mock.calls[0][0];
    expect(importedRows).toEqual([
      expect.objectContaining({
        externalId: 'new-row',
        source: 'notion',
        affectsBalance: false,
        accountId: 'cash-id',
        categoryId: 'other-expense-id',
        counterparty: 'Покупка',
        comment: 'Покупка — для офиса',
        status: FinanceTxStatus.COMPLETED,
      }),
    ]);
    expect(importedRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: 'after-cutover' }),
    ]));
    expect(backupSpy.mock.invocationCallOrder[0]).toBeLessThan(txRepo.save.mock.invocationCallOrder[0]);
    expect(activityRepo.save).toHaveBeenCalledTimes(1);
    expect(activityRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      route: 'SYSTEM notion-historical-transactions-v1',
      details: expect.objectContaining({
        imported: 1,
        safetyBackupId: 'backup-1',
        affectsBalance: false,
      }),
    }));
  });

  it('fails atomically when an existing Notion row differs from the canonical dataset', async () => {
    const rows = [{
      externalId: 'canonical-row',
      date: '2026-05-03',
      type: 'income',
      amount: 100,
      accountKey: 'cash',
      fromKey: null,
      toKey: null,
      categoryKey: 'smm',
      name: 'Каноническая строка',
      comment: '',
    }] as any;
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'damaged-row',
        type: FinanceTxType.INCOME,
        amount: 99,
        date: '2026-05-03',
        accountId: 'cash-id',
        categoryId: 'smm-id',
        source: 'notion',
        externalId: 'canonical-row',
        affectsBalance: false,
      }),
    ]);
    accountRepo.find.mockResolvedValue([{ id: 'cash-id', key: 'cash', name: 'Cash' }]);
    categoryRepo.find.mockResolvedValue([
      { id: 'smm-id', key: 'smm', name: 'SMM', type: 'income' },
    ]);
    const backupSpy = jest.spyOn(service as any, 'saveBackupWithManager');

    await expect((service as any).importNotionHistoricalTransactions(rows))
      .rejects.toThrow(
        'Архив Notion canonical-row: существующая операция не совпадает с источником (сумма)',
      );

    expect(managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      [20_260_201],
    );
    expect(backupSpy).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(activityRepo.save).not.toHaveBeenCalled();
  });

  it('uses the Notion archive from zero, then resets to the CRM balance in June', async () => {
    expect((service as any).notionHistoryTotals(NOTION_HISTORY_TRANSACTIONS))
      .toMatchObject(NOTION_HISTORY_TOTALS);
    const historical = NOTION_HISTORY_TRANSACTIONS.map(row => transaction({
      id: row.externalId,
      type: row.type as FinanceTxType,
      amount: row.amount,
      date: row.date,
      accountId: row.accountKey ? 'cash-id' : null,
      fromAccountId: row.fromKey ? 'cash-id' : null,
      toAccountId: row.toKey ? 'cash-id-2' : null,
      categoryId: row.categoryKey ? `category-${row.categoryKey}` : null,
      category: row.categoryKey,
      comment: row.name,
      source: 'notion',
      externalId: row.externalId,
      affectsBalance: false,
    }));
    const crmRows = [
      transaction({
        id: 'crm-income',
        type: FinanceTxType.INCOME,
        amount: 50,
        date: '2026-06-10',
        accountId: 'cash-id',
      }),
      transaction({
        id: 'crm-expense',
        type: FinanceTxType.EXPENSE,
        amount: 10,
        date: '2026-06-11',
        accountId: 'cash-id',
      }),
    ];
    jest.spyOn(service, 'accountsBalances').mockResolvedValue({
      perAccount: [{
        id: 'cash-id',
        key: 'cash',
        name: 'Cash',
        startBalance: 1_000,
        income: 50,
        expense: 10,
        saving: 0,
        transferIn: 0,
        transferOut: 0,
        balance: 1_040,
      }],
      total: { startBalance: 1_000, income: 50, expense: 10, balance: 1_040 },
    });
    projectRepo.find.mockResolvedValue([]);
    employeeRepo.find.mockResolvedValue([]);
    subscriptionRepo.find.mockResolvedValue([]);
    debtRepo.find.mockResolvedValue([]);
    plannedPaymentRepo.find.mockResolvedValue([]);
    forecastAdjustmentRepo.find.mockResolvedValue([]);
    categoryRepo.find.mockResolvedValue([
      { id: 'category-salary', key: 'salary', name: 'Зарплата', type: 'expense' },
    ]);
    txRepo.find.mockResolvedValue([...historical, ...crmRows]);

    const archive = await service.forecast('2026-02', 5, 'base');
    const current = await service.forecast('2026-06', 3, 'base');

    expect(archive.availableFrom).toBe('2026-02');
    expect(archive.rows.map(row => ({
      ym: row.ym,
      income: row.income,
      expense: row.expense,
    }))).toEqual([
      { ym: '2026-02', income: 8_550, expense: 1_313.02 },
      { ym: '2026-03', income: 12_900, expense: 15_461 },
      { ym: '2026-04', income: 38_214, expense: 33_034.79 },
      { ym: '2026-05', income: 38_230, expense: 45_120.81 },
      { ym: '2026-06', income: 50, expense: 10 },
    ]);
    expect(archive.rows.map(row => row.closingBalance)).toEqual([
      7_236.98,
      4_675.98,
      9_855.19,
      2_964.38,
      1_040,
    ]);
    expect(archive.rows[0]).toMatchObject({
      openingBalance: 0,
      balanceBasis: 'notion_history',
      balanceReset: false,
    });
    expect(archive.rows[4]).toMatchObject({
      openingBalance: 1_000,
      closingBalance: 1_040,
      balanceBasis: 'crm_cutover',
      balanceReset: true,
    });
    expect(archive.rows[0].incomeSources[0]).toMatchObject({
      imported: true,
      source: 'notion',
      date: '2026-02-19',
      accountName: 'Cash',
      kind: 'Архив Notion · получено',
    });
    expect(archive.rows.flatMap(row => row.expenseSources)
      .find(source => source.categoryName === 'Зарплата')).toMatchObject({
      imported: true,
      salary: true,
      kind: 'Архив Notion · оплачено',
    });
    expect(current.rows[0]).toMatchObject({
      ym: '2026-06',
      openingBalance: 1_000,
      income: 50,
      expense: 10,
      closingBalance: 1_040,
      balanceBasis: 'crm_cutover',
      balanceReset: false,
    });
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

  it('does not allow imported historical transactions to be edited or cancelled', async () => {
    const imported = transaction({
      id: 'notion-row',
      source: 'notion',
      externalId: 'notion-page',
      affectsBalance: false,
    });
    txRepo.findOne.mockResolvedValue(imported);

    await expect(service.updateTransaction(imported.id, { amount: 50 }))
      .rejects.toThrow('Историческую импортированную операцию нельзя изменить вручную');
    await expect(service.removeTransaction(imported.id))
      .rejects.toThrow('Историческую импортированную операцию нельзя отменить вручную');
    expect(txRepo.update).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('returns all-time salary changes and keeps legacy advance history', async () => {
    employeeRepo.findOne.mockResolvedValue({
      id: 'employee-1',
      name: 'Сотрудник',
      salary: 5_000,
      hireDate: '2026-01-10',
      terminationDate: null,
      status: 'active',
      employmentHistory: null,
      salaryHistory: {
        '2026-01': 3_000,
        '2026-04': 4_000,
        '2026-05': 4_000,
        '2026-07': 5_000,
      },
      salarySnapshots: null,
      advances: { '2026-02': 500 },
      bonuses: null,
      fines: { '2026-03': 100 },
    });
    jest.spyOn(service as any, 'maps').mockResolvedValue({
      ...emptyMaps,
      accounts: [{ id: 'account-1', key: 'cash', name: 'Наличные' }],
      acc: new Map([['account-1', { id: 'account-1', key: 'cash', name: 'Наличные' }]]),
    });
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'salary-old',
        employeeId: 'employee-1',
        amount: 3_000,
        date: '2026-02-10',
        salaryYm: '2026-01',
        comment: 'Зарплата',
        account: 'cash',
      }),
      transaction({
        id: 'advance-old',
        employeeId: 'employee-1',
        amount: 300,
        date: '2026-03-20',
        salaryYm: '2026-03',
        comment: 'Аванс — на дорогу',
        accountId: 'account-1',
      }),
      transaction({
        id: 'cancelled',
        employeeId: 'employee-1',
        amount: 999,
        date: '2026-04-01',
        salaryYm: '2026-04',
        comment: 'Аванс',
        status: FinanceTxStatus.CANCELLED,
      }),
      transaction({
        id: 'future',
        employeeId: 'employee-1',
        amount: 999,
        date: '2999-08-01',
        salaryYm: '2999-08',
        comment: 'Аванс',
      }),
    ]);

    const result = await service.employeePayoutHistory('employee-1', 0);

    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'salary-old',
        accountName: 'Наличные',
        salaryYm: '2026-01',
      }),
      expect.objectContaining({
        id: 'advance-old',
        kind: 'advance',
        note: 'на дорогу',
      }),
    ]));
    expect(result.salaryChanges).toEqual([
      { effectiveYm: '2026-07', salary: 5_000, previousSalary: 4_000, delta: 1_000, isCurrent: true, isFuture: false },
      { effectiveYm: '2026-04', salary: 4_000, previousSalary: 3_000, delta: 1_000, isCurrent: false, isFuture: false },
      { effectiveYm: '2026-01', salary: 3_000, previousSalary: null, delta: null, isCurrent: false, isFuture: false },
    ]);
    expect(result.periods.find(period => period.ym === '2026-02')).toMatchObject({
      advance: 500,
    });
  });

  it('keeps a fixed salary when an advance is followed by the final payment', async () => {
    employeeRepo.findOne.mockResolvedValue({
      id: 'employee-1',
      name: 'Сотрудник',
      salary: 5_000,
      hireDate: '2026-03-10',
      terminationDate: null,
      status: 'active',
      employmentHistory: null,
      salaryHistory: { '2026-03': 5_000 },
      salarySnapshots: {
        '2026-06': {
          salary: 5_000,
          advance: 1_000,
          bonus: 0,
          fine: 0,
          // Legacy-снимок хранил здесь только финальную выплату.
          paid: 4_000,
          paidAt: '2026-07-10',
        },
      },
      advances: { '2026-06': 1_000 },
      bonuses: null,
      fines: null,
    });
    jest.spyOn(service as any, 'maps').mockResolvedValue(emptyMaps);
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'salary-final',
        employeeId: 'employee-1',
        amount: 4_000,
        date: '2026-07-10',
        salaryYm: '2026-06',
        comment: 'Зарплата',
      }),
    ]);

    const result = await service.employeePayoutHistory('employee-1', 0);

    expect(result.salaryChanges).toEqual([
      expect.objectContaining({ effectiveYm: '2026-03', salary: 5_000, previousSalary: null }),
    ]);
    expect(result.periods.find(period => period.ym === '2026-06')).toMatchObject({
      salary: 5_000,
      advance: 1_000,
      recordedPaid: 5_000,
    });
  });

  it('does not add an advance twice when it already exists in the operation journal', async () => {
    employeeRepo.findOne.mockResolvedValue({
      id: 'employee-1',
      name: 'Сотрудник',
      salary: 4_000,
      hireDate: '2026-03-10',
      terminationDate: null,
      status: 'active',
      employmentHistory: null,
      salaryHistory: { '2026-03': 4_000 },
      salarySnapshots: {
        '2026-06': {
          salary: 4_000,
          advance: 1_000,
          bonus: 0,
          fine: 0,
          paid: 4_000,
          paidAt: '2026-07-10',
        },
      },
      advances: null,
      bonuses: null,
      fines: null,
    });
    jest.spyOn(service as any, 'maps').mockResolvedValue(emptyMaps);
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'advance',
        employeeId: 'employee-1',
        amount: 1_000,
        date: '2026-07-01',
        salaryYm: '2026-06',
        comment: 'Аванс',
      }),
      transaction({
        id: 'salary-final',
        employeeId: 'employee-1',
        amount: 3_000,
        date: '2026-07-10',
        salaryYm: '2026-06',
        comment: 'Зарплата',
      }),
    ]);

    const result = await service.employeePayoutHistory('employee-1', 0);

    expect(result.periods.find(period => period.ym === '2026-06')).toMatchObject({
      salary: 4_000,
      advance: 1_000,
      paidByOperations: 4_000,
      recordedPaid: 4_000,
    });
  });

  it('keeps the closed snapshot total when only part of the old journal survived', async () => {
    employeeRepo.findOne.mockResolvedValue({
      id: 'employee-1',
      name: 'Сотрудник',
      salary: 5_000,
      hireDate: '2026-03-10',
      terminationDate: null,
      status: 'active',
      employmentHistory: null,
      salaryHistory: { '2026-03': 5_000 },
      salarySnapshots: {
        '2026-06': {
          salary: 5_000,
          advance: 1_000,
          bonus: 0,
          fine: 0,
          // Legacy: paid — финальная часть, отдельная операция не сохранилась.
          paid: 4_000,
          paidAt: '2026-07-10',
        },
      },
      advances: null,
      bonuses: null,
      fines: null,
    });
    jest.spyOn(service as any, 'maps').mockResolvedValue(emptyMaps);
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'advance-only',
        employeeId: 'employee-1',
        amount: 1_000,
        date: '2026-07-01',
        salaryYm: '2026-06',
        comment: 'Аванс',
      }),
    ]);

    const result = await service.employeePayoutHistory('employee-1', 0);

    expect(result.periods.find(period => period.ym === '2026-06')).toMatchObject({
      salary: 5_000,
      advance: 1_000,
      paidByOperations: 1_000,
      recordedPaid: 5_000,
    });
  });

  it('returns a Notion payroll total as a separate historical fact, not a salary rate', async () => {
    employeeRepo.findOne.mockResolvedValue({
      id: 'employee-1',
      name: 'Сотрудник',
      salary: 5_000,
      hireDate: '2026-03-10',
      terminationDate: null,
      status: 'active',
      employmentHistory: null,
      salaryHistory: { '2026-06': 4_000, '2026-07': 5_000 },
      salarySnapshots: null,
      legacyPayrollHistory: {
        '2026-05': { paid: 2_350, source: 'notion' },
      },
      advances: null,
      bonuses: null,
      fines: null,
    });
    jest.spyOn(service as any, 'maps').mockResolvedValue(emptyMaps);
    txRepo.find.mockResolvedValue([
      transaction({
        id: 'later-advance',
        employeeId: 'employee-1',
        amount: 500,
        date: '2026-05-20',
        salaryYm: '2026-05',
        comment: 'Аванс',
      }),
    ]);

    const result = await service.employeePayoutHistory('employee-1', 0);

    expect(result.periods).toEqual([
      expect.objectContaining({
        ym: '2026-05',
        salary: null,
        accrued: null,
        recordedPaid: 2_350,
        paidByOperations: 500,
        legacyCrmPaid: 500,
        legacySource: 'notion',
        frozen: false,
      }),
    ]);
    expect(result.salaryChanges).toEqual([
      expect.objectContaining({ effectiveYm: '2026-07', salary: 5_000 }),
      expect.objectContaining({ effectiveYm: '2026-06', salary: 4_000 }),
    ]);
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

  it('forces restored Notion history to remain balance-neutral', () => {
    const backup = {
      version: 2,
      accounts: [{ id: 'account-1', key: 'cash' }],
      categories: [{ id: 'category-1', key: 'smm' }],
      projects: [],
      employees: [],
      subscriptions: [],
      debts: [],
      plannedPayments: [],
      transactions: [{
        id: 'tx-1',
        source: 'notion',
        externalId: 'page-1',
        affectsBalance: true,
        amount: 100,
        accountId: 'account-1',
      }],
    };

    const normalized = (service as any).normalizeImportData(backup);

    expect(normalized.transactions[0]).toMatchObject({
      source: 'notion',
      externalId: 'page-1',
      affectsBalance: false,
    });
    expect(() => (service as any).validateImport(normalized)).not.toThrow();
  });

  it('validates Notion metadata and unique source/externalId pairs in backups', () => {
    const valid = {
      version: 2,
      accounts: [{ id: 'account-1', key: 'cash' }],
      categories: [{ id: 'category-1', key: 'smm' }],
      projects: [],
      employees: [],
      subscriptions: [],
      debts: [],
      plannedPayments: [],
      transactions: [{
        id: 'tx-1',
        source: 'notion',
        externalId: 'page-1',
        affectsBalance: false,
        amount: 100,
      }],
    };
    const copy = () => JSON.parse(JSON.stringify(valid));

    const missingExternalId = copy();
    missingExternalId.transactions[0].externalId = null;
    expect(() => (service as any).validateImport(missingExternalId))
      .toThrow('архив Notion требует externalId');

    const balanceChanging = copy();
    balanceChanging.transactions[0].affectsBalance = true;
    expect(() => (service as any).validateImport(balanceChanging))
      .toThrow('архив Notion должен иметь affectsBalance=false');

    const duplicated = copy();
    duplicated.transactions.push({ ...duplicated.transactions[0], id: 'tx-2' });
    expect(() => (service as any).validateImport(duplicated))
      .toThrow('повторяющаяся пара source/externalId notion/page-1');
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

describe('legacy Notion payroll facts', () => {
  it('contains only pre-June months and preserves the source totals', () => {
    const totals: Record<string, number> = {};
    for (const employee of NOTION_PAYROLL_HISTORY) {
      for (const [ym, amount] of Object.entries(employee.paidByYm)) {
        expect(ym < '2026-06').toBe(true);
        totals[ym] = (totals[ym] || 0) + amount;
      }
    }
    expect(totals).toEqual({
      '2026-03': 6_800,
      '2026-04': 12_900,
      '2026-05': 22_350,
    });
    expect(NOTION_CONFIRMED_SALARY_HISTORY).toEqual([
      { name: 'Навруз Марданов Шаймарданович', effectiveYm: '2026-03', salary: 4_000 },
    ]);
  });
});
