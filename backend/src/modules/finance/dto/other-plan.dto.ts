import { IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Своя цифра «Прочего» на месяц (01.11.2026); amount = null — вернуть среднее. */
export class SetOtherPlanDto {
  @ApiProperty({ example: '2026-12' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000)
  amount?: number | null;
}
