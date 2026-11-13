import { Type } from 'class-transformer';
import {
  Allow, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { MAX_COMPOSE_CHARS } from './direct-text';

/** Фронт добавляет к каждому GET метку `_t` против кэша (lib/api.ts), а
 *  ValidationPipe с forbidNonWhitelisted отверг бы её с 400. */
class CacheBustQuery {
  @IsOptional() @Allow()
  _t?: string;
}

/** Вкладки списка: mine — чаты, которые веду я; free — ни за кем не закреплены;
 *  archived — убранные в архив (в остальных вкладках их нет). */
export const DIRECT_VIEWS = ['all', 'mine', 'free', 'unread', 'waiting', 'archived'] as const;
export type DirectView = typeof DIRECT_VIEWS[number];

/** Фильтры списка поверх вкладки: метка, есть ли лид, моё напоминание. */
class DirectFiltersQuery extends CacheBustQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  /** Чаты одного менеджера — фильтр руководства и переход из «Аналитики». */
  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @IsUUID()
  labelId?: string;

  /** with — лид из чата создан, without — ещё нет. */
  @IsOptional() @IsIn(['with', 'without'])
  lead?: 'with' | 'without';

  /** 1 — только чаты, где у меня есть напоминание. */
  @IsOptional() @IsIn(['1'])
  reminder?: '1';

  /** Чаты одного аккаунта Instagram (id аккаунта). */
  @IsOptional() @Matches(/^\d{1,32}$/)
  account?: string;
}

export class DirectListQueryDto extends DirectFiltersQuery {
  @IsOptional() @IsIn(DIRECT_VIEWS as unknown as string[])
  view?: DirectView;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class DirectCountsQueryDto extends DirectFiltersQuery {}

/** Передать чат менеджеру продаж; null — освободить. */
export class DirectAssignDto {
  @IsOptional() @IsUUID()
  userId?: string | null;
}

export class DirectMessagesQueryDto extends CacheBustQuery {
  @IsOptional() @IsUUID()
  before?: string;

  /** Переход к сообщению из поиска: всё от него до самого свежего. */
  @IsOptional() @IsUUID()
  until?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

export class DirectSendTextDto {
  @IsString() @MinLength(1) @MaxLength(MAX_COMPOSE_CHARS)
  text: string;

  /** Ответ на сообщение этого чата (id в CRM): в Instagram уходит цитатой. */
  @IsOptional() @IsUUID()
  replyToId?: string;

  /** Метка временного пузыря на странице: им ответ заменит «отправляется». */
  @IsOptional() @IsString() @MaxLength(64)
  clientId?: string;
}

/** Подпись к файлу — необязательна. */
export class DirectSendFileDto {
  @IsOptional() @IsString() @MaxLength(MAX_COMPOSE_CHARS)
  text?: string;

  @IsOptional() @IsUUID()
  replyToId?: string;

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

  /** Кого упомянули через @Имя — им придёт уведомление. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true })
  mentions?: string[];

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

/** Включить/выключить: закреп, архив, «непрочитанное», реакция ❤️. */
export class DirectToggleDto {
  @IsBoolean()
  on: boolean;
}

export class DirectSetLabelsDto {
  @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true })
  labelIds: string[];
}

/** Цвета меток — без красного и зелёного: они в CRM значат ошибку и «готово». */
export const LABEL_COLORS = ['sky', 'violet', 'amber', 'pink', 'teal', 'orange', 'indigo', 'slate'] as const;

export class DirectLabelDto {
  @IsString() @MinLength(1) @MaxLength(40)
  name: string;

  @IsOptional() @IsIn(LABEL_COLORS as unknown as string[])
  color?: string;
}

export class DirectLabelUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40)
  name?: string;

  @IsOptional() @IsIn(LABEL_COLORS as unknown as string[])
  color?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  sortOrder?: number;
}

export class DirectTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80)
  title: string;

  @IsString() @MinLength(1) @MaxLength(MAX_COMPOSE_CHARS)
  text: string;

  /** Общий для всей команды — может только руководство. */
  @IsOptional() @IsBoolean()
  shared?: boolean;
}

export class DirectTemplateUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  title?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(MAX_COMPOSE_CHARS)
  text?: string;
}

export class DirectReminderDto {
  @IsISO8601()
  remindAt: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class DirectSearchQueryDto extends CacheBustQuery {
  @IsString() @MinLength(2) @MaxLength(100)
  q: string;

  /** Искать только в этом чате. */
  @IsOptional() @IsUUID()
  conversationId?: string;
}

/** Подключить аккаунт Instagram: маркер из кабинета Meta. */
export class DirectConnectAccountDto {
  @IsString() @MinLength(20) @MaxLength(1000)
  token: string;
}
