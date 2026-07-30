import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Создать ожидаемую плановую оплату (проект ИЛИ долг). */
export class CreatePlannedPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()
  projectId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  debtId?: string;

  @ApiProperty({ example: '2026-07' }) @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  partNo?: number;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0)
  amount: number;

  /** Срок оплаты (к какой дате ждём платёж). */
  @ApiPropertyOptional({ example: '2026-07-24' }) @IsOptional() @IsISO8601()
  dueDate?: string;
}
