import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Запись удержания (штраф / отпускные) за месяц — журнал с датой и суммой. */
export class AddDeductionDto {
  @ApiProperty({ example: 'fine', enum: ['fine', 'vacation'] }) @IsIn(['fine', 'vacation'])
  kind!: 'fine' | 'vacation';

  @ApiPropertyOptional({ example: '2026-07' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym?: string;

  @ApiProperty({ example: 300 }) @IsNumber() @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: '2026-09-02' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  date?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Отпускные: начало периода' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-07', description: 'Отпускные: конец периода' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  dateTo?: string;

  @ApiPropertyOptional({ example: 'опоздание' }) @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

/** Обновление комментария у записи удержания. */
export class UpdateDeductionNoteDto {
  @ApiProperty({ example: 'fine', enum: ['fine', 'vacation'] }) @IsIn(['fine', 'vacation'])
  kind!: 'fine' | 'vacation';

  @ApiPropertyOptional({ example: '2026-07' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym?: string;

  @ApiPropertyOptional({ example: 'опоздание на съёмку' }) @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

/** Удаление записи удержания (kind/ym в query). */
export class RemoveDeductionQueryDto {
  @ApiProperty({ example: 'fine', enum: ['fine', 'vacation'] }) @IsIn(['fine', 'vacation'])
  kind!: 'fine' | 'vacation';

  @ApiPropertyOptional({ example: '2026-07' }) @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  ym?: string;
}
