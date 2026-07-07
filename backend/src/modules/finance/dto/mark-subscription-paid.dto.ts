import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Отметка «оплачено без операции»: месяц + дата фактической оплаты.
 *  Не создаёт расход в журнале — балансы счетов не меняются. */
export class MarkSubscriptionPaidDto {
  @ApiPropertyOptional({ example: '2026-07' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym?: string;

  @ApiPropertyOptional({ example: '2026-07-02' }) @IsOptional() @IsISO8601()
  date?: string;
}
