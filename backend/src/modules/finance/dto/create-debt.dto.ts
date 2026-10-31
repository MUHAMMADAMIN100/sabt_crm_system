import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Транш долга (31.10.2026): дата и сумма, когда собираемся отдать часть. */
export class DebtTrancheDto {
  @ApiProperty({ example: '2026-11-15' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01)
  amount: number;
}

export class CreateDebtDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  counterparty?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  paidBefore?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  monthlyPayment?: number;

  @ApiPropertyOptional({ example: 10, description: 'День месяца планового погашения (1..31)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dueDay?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  /** 'bank' — кредит или рассрочка компании в банке («Рассрочки»). */
  @ApiPropertyOptional({ enum: ['debt', 'bank'] }) @IsOptional() @IsIn(['debt', 'bank'])
  kind?: 'debt' | 'bank';

  /** «Вернуть до» — необязательный срок (YYYY-MM-DD), null — без срока. */
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string | null;

  /** План траншей настоящего долга. Передан — заменяет ещё не отданные
   *  транши; [] — плана нет («когда получится»). Не передан — план не трогаем. */
  @ApiPropertyOptional({ type: [DebtTrancheDto] }) @IsOptional() @IsArray() @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => DebtTrancheDto)
  tranches?: DebtTrancheDto[];
}
