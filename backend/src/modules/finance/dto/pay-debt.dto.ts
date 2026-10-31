import { IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** «Отдать» по долгу (31.10.2026): любая сумма с любого счёта — расход. */
export class PayDebtDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01)
  amount: number;

  @ApiProperty() @IsUUID()
  accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}
