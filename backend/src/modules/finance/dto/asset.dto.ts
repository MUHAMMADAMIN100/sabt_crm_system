import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const STATUSES = ['in_use', 'repair', 'written_off', 'sold'];

/** Единица инвентаря: оборудование с линейной амортизацией. */
export class CreateAssetDto {
  @ApiProperty({ example: 'Sony A7 IV' }) @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Техника' }) @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ example: '2026-01-15' }) @IsOptional() @IsISO8601()
  purchaseDate?: string;

  @ApiPropertyOptional({ example: 25000 }) @IsOptional() @IsNumber() @Min(0)
  price?: number;

  /** Срок службы в месяцах; 0 — не амортизируется. */
  @ApiPropertyOptional({ example: 36 }) @IsOptional() @IsNumber() @Min(0)
  serviceMonths?: number;

  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Бехруз' }) @IsOptional() @IsString() @MaxLength(200)
  assignee?: string;

  @ApiPropertyOptional({ example: 'SN-123456' }) @IsOptional() @IsString() @MaxLength(120)
  serial?: string;

  @ApiPropertyOptional({ example: '2027-01-15' }) @IsOptional() @IsISO8601()
  warrantyUntil?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  purchaseDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)
  price?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)
  serviceMonths?: number;

  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES)
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  assignee?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  serial?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  warrantyUntil?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  note?: string;
}
