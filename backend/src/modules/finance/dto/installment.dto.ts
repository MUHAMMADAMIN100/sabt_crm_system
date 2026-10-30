import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Записать покупку расходом: откуда заплатили и когда. */
export class InstallmentPurchaseDto {
  @ApiProperty() @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({ example: '2026-10-03' }) @IsOptional() @IsString() @Matches(DATE)
  date?: string;

  @ApiPropertyOptional({ description: 'Сумма покупки, если отличается от стоимости рассрочки' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  amount?: number;
}

export class CreateInstallmentDto {
  @ApiProperty() @IsUUID()
  employeeId!: string;

  @ApiProperty({ example: 'iPhone 15 · 128 ГБ' }) @IsString() @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 9600 }) @Type(() => Number) @IsNumber() @Min(0)
  totalAmount!: number;

  @ApiProperty({ example: 800 }) @Type(() => Number) @IsNumber() @Min(0)
  monthlyAmount!: number;

  @ApiPropertyOptional({ example: '2026-10' }) @IsOptional() @IsString() @Matches(YM)
  startYm?: string;

  @ApiPropertyOptional({ example: 0 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  paidBefore?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ enum: ['salary', 'separate'] }) @IsOptional() @IsIn(['salary', 'separate'])
  method?: 'salary' | 'separate';

  @ApiPropertyOptional({ example: 5, description: 'День оплаты для «платит отдельно»' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dueDay?: number;

  /** Рассрочка через банк: название банка; пусто или null — без банка. */
  @ApiPropertyOptional({ example: 'Алиф', nullable: true }) @IsOptional() @IsString() @MaxLength(100)
  bankName?: string | null;

  /** День, когда компания платит банку. */
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  bankDueDay?: number;

  @ApiPropertyOptional({ type: InstallmentPurchaseDto })
  @IsOptional() @ValidateNested() @Type(() => InstallmentPurchaseDto)
  purchase?: InstallmentPurchaseDto;
}

export class UpdateInstallmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  monthlyAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(YM)
  startYm?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  paidBefore?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ enum: ['salary', 'separate'] }) @IsOptional() @IsIn(['salary', 'separate'])
  method?: 'salary' | 'separate';

  @ApiPropertyOptional({ example: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dueDay?: number;

  /** Рассрочка через банк: название банка; пусто или null — без банка. */
  @ApiPropertyOptional({ example: 'Алиф', nullable: true }) @IsOptional() @IsString() @MaxLength(100)
  bankName?: string | null;

  /** День, когда компания платит банку. */
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  bankDueDay?: number;

  @ApiPropertyOptional({ type: InstallmentPurchaseDto })
  @IsOptional() @ValidateNested() @Type(() => InstallmentPurchaseDto)
  purchase?: InstallmentPurchaseDto;
}

/** Перенести дату платежа месяца («платит отдельно»); без даты — вернуть число. */
export class InstallmentDueDto {
  @ApiProperty({ example: '2026-11' }) @IsString() @Matches(YM)
  ym!: string;

  @ApiPropertyOptional({ example: '2026-11-20', nullable: true }) @IsOptional() @IsString() @Matches(DATE)
  date?: string | null;
}

/** Своя сумма удержания на месяц: 0 — пропустить, null — как обычно. */
export class InstallmentMonthDto {
  @ApiProperty({ example: '2026-11' }) @IsString() @Matches(YM)
  ym!: string;

  @ApiPropertyOptional({ example: 0, nullable: true })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  amount?: number | null;
}

/** Платёж деньгами мимо зарплаты (принёс сам / закрыли досрочно). */
export class InstallmentPaymentDto {
  @ApiProperty({ example: 1600 }) @Type(() => Number) @IsNumber() @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: '2026-10-24' }) @IsOptional() @IsString() @Matches(DATE)
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  note?: string;

  @ApiProperty({ description: 'Счёт, куда пришли деньги' }) @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({ example: '2026-12', description: 'За какой месяц в первую очередь; остаток — ближайшие' })
  @IsOptional() @IsString() @Matches(YM)
  ym?: string;
}

/** «Удержано из зарплаты» за месяц: on=false — снять отметку. */
export class InstallmentMarkDto {
  @ApiProperty({ example: '2026-11' }) @IsString() @Matches(YM)
  ym!: string;

  @ApiProperty() @IsBoolean()
  on!: boolean;
}
