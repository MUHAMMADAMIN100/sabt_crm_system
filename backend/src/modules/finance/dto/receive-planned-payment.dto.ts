import { IsISO8601, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Отметить плановую оплату полученной: на какой счёт и какой датой.
 *  amount < плана — частичная оплата: остаток остаётся ожидаемым планом. */
export class ReceivePlannedPaymentDto {
  @ApiProperty() @IsUUID()
  accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ example: 500 }) @IsOptional() @IsNumber() @Min(0.01)
  amount?: number;
}
