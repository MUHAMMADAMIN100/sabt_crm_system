import { Type } from 'class-transformer';
import {
  IsEnum, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdChannel, BudgetSource, AdStatus } from '../project-ad.entity';

export class CreateProjectAdDto {
  @ApiProperty() @IsString() @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ enum: AdChannel }) @IsOptional() @IsEnum(AdChannel)
  channel?: AdChannel;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  budget?: number;

  /** Дневной бюджет кампании (ТЗ §9.9). */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  dailyBudget?: number;

  @ApiPropertyOptional({ enum: BudgetSource }) @IsOptional() @IsEnum(BudgetSource)
  budgetSource?: BudgetSource;

  @ApiPropertyOptional({ enum: AdStatus }) @IsOptional() @IsEnum(AdStatus)
  status?: AdStatus;

  /** Таргетолог (ответственный за кампанию). */
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  targetologistId?: string;

  /** Связанная workflow-карточка. */
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  cardId?: string;

  @ApiProperty() @IsISO8601()
  startDate: string;

  @ApiProperty() @IsISO8601()
  endDate: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
