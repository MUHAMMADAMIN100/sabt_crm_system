import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceProjectDirection {
  SMM = 'smm',
  DEVELOPMENT = 'development',
  DESIGN = 'design',
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
}
