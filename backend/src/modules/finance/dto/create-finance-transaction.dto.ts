import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FinanceAccount, FinanceCategory, FinancePaymentMethod, FinanceTxStatus, FinanceTxType,
} from '../finance-transaction.entity';

class FinanceSplitDto {
  @ApiProperty({ enum: FinanceAccount }) @IsEnum(FinanceAccount)
  account: FinanceAccount;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  amount: number;
}

export class CreateFinanceTransactionDto {
  @ApiProperty({ enum: FinanceTxType }) @IsEnum(FinanceTxType)
  type: FinanceTxType;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  amount: number;

  @ApiProperty() @IsISO8601()
  date: string;

  @ApiProperty({ enum: FinanceAccount }) @IsEnum(FinanceAccount)
  account: FinanceAccount;

  @ApiPropertyOptional({ type: [FinanceSplitDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FinanceSplitDto)
  splits?: FinanceSplitDto[];

  @ApiProperty({ enum: FinanceCategory }) @IsEnum(FinanceCategory)
  category: FinanceCategory;

  @ApiProperty() @IsString() @MaxLength(500)
  description: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  counterparty?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  project?: string;

  @ApiPropertyOptional({ enum: FinancePaymentMethod }) @IsOptional() @IsEnum(FinancePaymentMethod)
  paymentMethod?: FinancePaymentMethod;

  @ApiPropertyOptional({ enum: FinanceTxStatus }) @IsOptional() @IsEnum(FinanceTxStatus)
  status?: FinanceTxStatus;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}
