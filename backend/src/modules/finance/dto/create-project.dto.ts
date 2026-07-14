import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceProjectDirection {
  SMM = 'smm',
  DEVELOPMENT = 'development',
  DESIGN = 'design',
}

export enum FinanceProjectStatus {
  LEAD = 'lead',
  ACTIVE = 'active',
  /** Клиент приостановил работу — неизвестно, продолжит ли: деньги и
   *  напоминания заморожены, раз в 2 недели ревизия «спросить клиента». */
  PAUSED = 'paused',
  DONE = 'done',
  ARCHIVED = 'archived',
}

export class CreateProjectDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: FinanceProjectDirection }) @IsOptional() @IsEnum(FinanceProjectDirection)
  direction?: FinanceProjectDirection;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  tariff?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  contractDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  multiMonth?: boolean;

  @ApiPropertyOptional({ enum: FinanceProjectStatus }) @IsOptional() @IsEnum(FinanceProjectStatus)
  status?: FinanceProjectStatus;
}
