import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Заявка на транспорт (multipart, 15.11.2026). Окно дат (не в будущем и не
 *  старше 60 дней по Душанбе) проверяет сервис — от «сегодня» он и считает. */
export class CreateTransportRequestDto {
  @ApiProperty() @IsUUID('all', { message: 'Выберите проект' })
  projectId: string;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsNumber({}, { message: 'Сумма — от 1 до 5000 сомони' })
  @Min(1, { message: 'Сумма — от 1 до 5000 сомони' })
  @Max(5000, { message: 'Сумма — от 1 до 5000 сомони' })
  amount: number;

  @ApiPropertyOptional({ example: '2026-11-15' }) @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Некорректная дата поездки' })
  date?: string;

  /** Сервис сам обрежет до 300 символов — здесь только защита от мусора. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

/** Оплатить заявку: с какого счёта. */
export class PayTransportRequestDto {
  @ApiProperty() @IsUUID('all', { message: 'Выберите счёт, с которого платите' })
  accountId: string;
}

/** Отклонить заявку: причина видна сотруднику. */
export class RejectTransportRequestDto {
  @ApiProperty() @IsString() @MaxLength(2000)
  reason: string;
}
