import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateOperationDto, FinanceOperationType } from './dto/create-operation.dto';
import { CreatePlannedPaymentDto } from './dto/create-planned-payment.dto';
import { PayNowDto } from './dto/pay-now.dto';
import { RemoveMonthExpensesDto } from './dto/remove-month-expenses.dto';
import { MarkSubscriptionPaidDto } from './dto/mark-subscription-paid.dto';
import { SetEmployeeBonusDto } from './dto/set-employee-bonus.dto';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

async function propertyIsValid<T extends object>(
  type: new () => T,
  data: Record<string, unknown>,
  property: string,
): Promise<boolean> {
  const errors = await validate(plainToInstance(type, data));
  return !errors.some(error => error.property === property);
}

describe('Finance DTO month validation', () => {
  it.each([
    ['create employee', CreateEmployeeDto, 'salaryEffectiveYm', (month: string) => ({ name: 'Сотрудник', salaryEffectiveYm: month })],
    ['update employee', UpdateEmployeeDto, 'salaryEffectiveYm', (month: string) => ({ salaryEffectiveYm: month })],
    ['operation salary period', CreateOperationDto, 'salaryYm', (month: string) => ({ type: FinanceOperationType.EXPENSE, amount: 100, salaryYm: month })],
    ['planned payment', CreatePlannedPaymentDto, 'ym', (month: string) => ({ ym: month, amount: 100 })],
    ['pay now', PayNowDto, 'ym', (month: string) => ({ ym: month, amount: 100, accountId: ACCOUNT_ID })],
    ['remove month expenses', RemoveMonthExpensesDto, 'ym', (month: string) => ({ ym: month })],
    ['subscription paid mark', MarkSubscriptionPaidDto, 'ym', (month: string) => ({ ym: month })],
    ['employee month amount', SetEmployeeBonusDto, 'ym', (month: string) => ({ ym: month, amount: 100 })],
  ])('%s accepts only a real calendar month', async (_name, type, property, makeData) => {
    await expect(propertyIsValid(type as any, makeData('2026-07'), property)).resolves.toBe(true);

    for (const invalid of ['2026-00', '2026-13', '2026-7', '20260-07']) {
      await expect(propertyIsValid(type as any, makeData(invalid), property)).resolves.toBe(false);
    }
  });
});

describe('Finance employee employment dates', () => {
  it.each([CreateEmployeeDto, UpdateEmployeeDto])(
    '%p validates the termination date',
    async (type) => {
      await expect(propertyIsValid(type as any, {
        name: 'Сотрудник',
        terminationDate: '2026-07-30',
      }, 'terminationDate')).resolves.toBe(true);
      await expect(propertyIsValid(type as any, {
        name: 'Сотрудник',
        terminationDate: 'не-дата',
      }, 'terminationDate')).resolves.toBe(false);
    },
  );
});
