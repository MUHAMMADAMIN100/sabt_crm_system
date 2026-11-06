import { Type } from 'class-transformer';
import { Allow, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_COMPOSE_CHARS } from './direct-text';

/** Фронт добавляет к каждому GET метку `_t` против кэша (lib/api.ts), а
 *  ValidationPipe с forbidNonWhitelisted отверг бы её с 400. */
class CacheBustQuery {
  @IsOptional() @Allow()
  _t?: string;
}

/** Вкладки списка: mine — чаты, которые веду я; free — ни за кем не закреплены. */
export const DIRECT_VIEWS = ['all', 'mine', 'free', 'unread', 'waiting'] as const;
export type DirectView = typeof DIRECT_VIEWS[number];

export class DirectListQueryDto extends CacheBustQuery {
  @IsOptional() @IsIn(DIRECT_VIEWS as unknown as string[])
  view?: DirectView;

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  /** Чаты одного менеджера — фильтр руководства и переход из «Аналитики». */
  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class DirectCountsQueryDto extends CacheBustQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsUUID()
  assigneeId?: string;
}

/** Передать чат менеджеру продаж; null — освободить. */
export class DirectAssignDto {
  @IsOptional() @IsUUID()
  userId?: string | null;
}

export class DirectMessagesQueryDto extends CacheBustQuery {
  @IsOptional() @IsUUID()
  before?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

export class DirectSendTextDto {
  @IsString() @MinLength(1) @MaxLength(MAX_COMPOSE_CHARS)
  text: string;

  /** Метка временного пузыря на странице: им ответ заменит «отправляется». */
  @IsOptional() @IsString() @MaxLength(64)
  clientId?: string;
}

/** Подпись к файлу — необязательна. */
export class DirectSendFileDto {
  @IsOptional() @IsString() @MaxLength(MAX_COMPOSE_CHARS)
  text?: string;

  /** Метка временного пузыря на странице: им ответ заменит «отправляется». */
  @IsOptional() @IsString() @MaxLength(64)
  clientId?: string;
}

export class DirectSendVoiceDto {
  /** Метка временного пузыря на странице: им ответ заменит «отправляется». */
  @IsOptional() @IsString() @MaxLength(64)
  clientId?: string;
}

export class DirectNoteDto {
  @IsString() @MinLength(1) @MaxLength(2000)
  text: string;

  /** Метка временного пузыря на странице: им ответ заменит «отправляется». */
  @IsOptional() @IsString() @MaxLength(64)
  clientId?: string;
}

export class DirectStatsQueryDto extends CacheBustQuery {
  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;
}
