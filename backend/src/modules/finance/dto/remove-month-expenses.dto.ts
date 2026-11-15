import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Снятие расходов месяца по сотруднику или подписке одной транзакцией
 *  (замена клиентского цикла удалений). Ровно одно из двух полей. */
export class RemoveMonthExpensesDto {
  @ApiProperty({ example: '2026-07' }) @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  subscriptionId?: string;

  /** Только определённый тип выплаты ЗП: 'advance' — авансы, 'bonus' — бонусы,
   *  'salary' — только выплаты зарплаты, без авансов и бонусов (15.11.2026).
   *  Без него удаляются все зарплатные операции месяца (полная отмена). */
  @ApiPropertyOptional({ enum: ['advance', 'bonus', 'salary'] }) @IsOptional() @IsIn(['advance', 'bonus', 'salary'])
  kind?: 'advance' | 'bonus' | 'salary';
}
