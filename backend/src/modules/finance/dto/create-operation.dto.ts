import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Тип операции из модалки «+ Операция». */
export enum FinanceOperationType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
  SAVING = 'saving',
}

/** Создание операции любого типа. Сервис дополнительно валидирует поля
 *  по типу (перевод требует двух счетов, доход/расход — счёта). */
export class CreateOperationDto {
  @ApiProperty({ enum: FinanceOperationType }) @IsEnum(FinanceOperationType)
  type: FinanceOperationType;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  amount: number;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  accountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  fromAccountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  projectId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  debtId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  subscriptionId?: string;

  /** Месяц начисления зарплаты ('YYYY-MM') — для зарплатных операций.
   *  Отделяет «за какой месяц» от даты фактической выплаты. */
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}$/)
  salaryYm?: string;
}
