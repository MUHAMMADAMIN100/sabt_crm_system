import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Создать ожидаемую плановую оплату (проект ИЛИ долг). */
export class CreatePlannedPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  projectId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  debtId?: string;

  @ApiProperty({ example: '2026-07' }) @IsString() @Matches(/^\d{4}-\d{2}$/)
  ym: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  partNo?: number;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  amount: number;
}
