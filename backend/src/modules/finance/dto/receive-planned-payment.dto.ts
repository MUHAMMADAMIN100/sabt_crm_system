import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Отметить плановую оплату полученной: на какой счёт и какой датой. */
export class ReceivePlannedPaymentDto {
  @ApiProperty() @IsUUID()
  accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  date?: string;
}
