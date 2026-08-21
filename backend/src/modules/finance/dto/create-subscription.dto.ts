import { IsBoolean, IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceSubscriptionKind {
  RENT = 'rent',
  SUBSCRIPTION = 'subscription',
}

export class CreateSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: FinanceSubscriptionKind }) @IsOptional() @IsEnum(FinanceSubscriptionKind)
  kind?: FinanceSubscriptionKind;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  amount?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;

  /** День оплаты (1..31) — для напоминаний; null — без срока. */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dueDay?: number | null;

  /** Дата начала (первое списание, 'YYYY-MM-DD'). Из неё выводится dueDay. */
  @ApiPropertyOptional({ example: '2026-09-12' }) @IsOptional() @IsISO8601()
  dueDate?: string | null;

  /** Дата окончания ('YYYY-MM-DD'); null — без ограничения. */
  @ApiPropertyOptional({ example: '2027-09-12' }) @IsOptional() @IsISO8601()
  endDate?: string | null;
}
