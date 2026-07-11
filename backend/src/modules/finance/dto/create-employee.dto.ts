import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceEmployeeStatus {
  ACTIVE = 'active',
  FIRED = 'fired',
}

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  role?: string;

  /** Категория/отдел для группировки зарплатной ведомости. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  category?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  salary?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  advance?: number;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  hireDate?: string;

  @ApiPropertyOptional({ enum: FinanceEmployeeStatus }) @IsOptional() @IsEnum(FinanceEmployeeStatus)
  status?: FinanceEmployeeStatus;
}
