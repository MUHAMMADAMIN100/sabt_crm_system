import { Type } from 'class-transformer';
import {
  IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdChannel, BudgetSource } from '../project-ad.entity';

export class CreateProjectAdDto {
  @ApiProperty() @IsString() @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ enum: AdChannel }) @IsOptional() @IsEnum(AdChannel)
  channel?: AdChannel;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  budget?: number;

  @ApiPropertyOptional({ enum: BudgetSource }) @IsOptional() @IsEnum(BudgetSource)
  budgetSource?: BudgetSource;

  @ApiProperty() @IsISO8601()
  startDate: string;

  @ApiProperty() @IsISO8601()
  endDate: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
