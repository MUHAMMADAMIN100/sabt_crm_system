import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Оплатить сразу: создать связанную операцию + плановую оплату (received). */
export class PayNowDto {
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

  @ApiProperty() @IsUUID()
  accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}
