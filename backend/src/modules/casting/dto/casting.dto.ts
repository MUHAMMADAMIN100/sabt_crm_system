import {
  Allow, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { NoCoerce } from '../../dev-tracker/dto/no-coerce.transform';
import { BOOKING_STATUSES } from '../casting.logic';

/**
 * Тела запросов кастинга (docs/CASTING_SPEC.md §3–4). Здесь — типы и
 * грубые пределы; смысл (метки → ключи, ссылки только http(s), дата
 * рождения не в будущем, возраст) проверяет casting.logic.talentPatch.
 * Категории и опыт принимаем ключами или русскими подписями.
 */
export class CreateTalentDto {
  @ApiProperty() @NoCoerce() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ type: [String], description: 'actor | blogger | model (или подписи)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true })
  categories?: string[];

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(200)
  city?: string | null;

  /** Свободный текст; число тоже примем (глобальная конверсия сделает строку). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20)
  height?: string | null;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD или null' }) @IsOptional() @NoCoerce() @IsString() @MaxLength(10)
  birthDate?: string | null;

  /** Возраст, если даты рождения нет: сохраняется как «возраст на сегодня». */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120)
  age?: number | null;

  /** То же, что age (так называет поле форма CRM); age важнее, если пришли оба. */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120)
  ageBase?: number | null;

  @ApiPropertyOptional({ type: [String], description: 'ads | film | theatre | clips | social | model (или подписи)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(60, { each: true })
  tags?: string[];

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(5000)
  experience?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(500, { each: true })
  links?: string[];

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(64)
  telegram?: string | null;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(120)
  rate?: string | null;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsBoolean()
  isArchived?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  sortOrder?: number;
}

/** PATCH: любые поля формы и «в архив». */
export class UpdateTalentDto extends PartialType(CreateTalentDto) {}

export class PhotoOrderDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  ids: string[];
}

export class AddBookingDto {
  @ApiProperty() @IsUUID('all')
  talentId: string;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(500)
  note?: string | null;
}

export class UpdateBookingDto {
  @ApiPropertyOptional({ enum: [...BOOKING_STATUSES] })
  @IsOptional() @IsIn([...BOOKING_STATUSES], { message: 'Статус: invited, confirmed или declined' })
  status?: string;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(500)
  note?: string | null;
}

/** Заявка с публичного каталога. website — ловушка для ботов: принимаем
 *  что угодно, непустое — тихий «ok». Длину имени и цифры телефона
 *  проверяет cleanBooking (с понятным текстом ошибки). */
export class PublicBookDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(64, { each: true })
  talentIds: string[];

  @ApiProperty() @NoCoerce() @IsString() @MaxLength(200)
  name: string;

  @ApiProperty() @NoCoerce() @IsString() @MaxLength(60)
  phone: string;

  @ApiPropertyOptional() @IsOptional() @NoCoerce() @IsString() @MaxLength(2000)
  comment?: string | null;

  @ApiPropertyOptional() @IsOptional() @Allow()
  website?: unknown;
}
