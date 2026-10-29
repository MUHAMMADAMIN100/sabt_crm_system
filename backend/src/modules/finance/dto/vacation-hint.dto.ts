import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Решение по отпуску «за свой счёт» в ведомости: удержать или нет. */
export class VacationHintDto {
  @ApiProperty() @IsUUID()
  vacationId!: string;

  @ApiProperty({ example: '2026-10' }) @IsString() @Matches(YM)
  ym!: string;

  @ApiProperty({ enum: ['withhold', 'dismiss'] }) @IsIn(['withhold', 'dismiss'])
  action!: 'withhold' | 'dismiss';

  /** Своя сумма вместо подсказанной. */
  @ApiPropertyOptional({ example: 1111 }) @IsOptional() @IsNumber() @Min(0)
  amount?: number;
}

/** Сколько отпуск стоит по месяцам — для карточки сотрудника. */
export class VacationPreviewQueryDto {
  @ApiProperty() @IsUUID()
  userId!: string;

  @ApiProperty({ example: '2026-10-26' }) @IsString() @Matches(DAY)
  from!: string;

  @ApiProperty({ example: '2026-11-09' }) @IsString() @Matches(DAY)
  until!: string;
}
