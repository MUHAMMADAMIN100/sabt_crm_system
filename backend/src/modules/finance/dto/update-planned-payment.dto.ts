import { IsISO8601, IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Правка ОЖИДАЕМОЙ плановой оплаты: сумма и/или срок.
 *  Полученные не правятся — их сумма привязана к операции журнала. */
export class UpdatePlannedPaymentDto {
  @ApiPropertyOptional({ example: 52500 }) @IsOptional() @IsNumber() @Min(0.01)
  amount?: number;

  /** null/'' — убрать срок. */
  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601()
  dueDate?: string | null;
}
