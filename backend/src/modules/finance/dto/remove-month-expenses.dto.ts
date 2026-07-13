import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Снятие расходов месяца по сотруднику или подписке одной транзакцией
 *  (замена клиентского цикла удалений). Ровно одно из двух полей. */
export class RemoveMonthExpensesDto {
  @ApiProperty({ example: '2026-07' }) @IsString() @Matches(/^\d{4}-\d{2}$/)
  ym: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  subscriptionId?: string;
}
