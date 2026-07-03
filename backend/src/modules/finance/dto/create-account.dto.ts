import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceAccountKind {
  BANK = 'bank',
  CASH = 'cash',
  SAVINGS = 'savings',
}

export class CreateAccountDto {
  @ApiProperty() @IsString() @MaxLength(120)
  name: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber()
  startBalance?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16)
  color?: string;

  @ApiPropertyOptional({ enum: FinanceAccountKind }) @IsOptional() @IsEnum(FinanceAccountKind)
  kind?: FinanceAccountKind;
}
