import { IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Бонус сотрудника за месяц. amount = 0 снимает бонус. */
export class SetEmployeeBonusDto {
  @ApiPropertyOptional({ example: '2026-07' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym?: string;

  @ApiPropertyOptional({ example: 500 }) @IsOptional() @IsNumber() @Min(0)
  amount?: number;
}
