import {
  IsBoolean, IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsPositive, IsString, IsUUID,
  Matches, Max, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Тела запросов /api/sales/* (15.11.2026). Договор — docs/SALES_SPEC.md §5.
 * ValidationPipe глобально с whitelist + forbidNonWhitelisted: лишнее поле
 * в теле — 400, а не молча проглоченное значение.
 */

export const CALL_RESULTS = ['reached', 'no_answer', 'busy'] as const;
export type CallResult = typeof CALL_RESULTS[number];

export const CALL_OUTCOMES = ['interested', 'wants_kp', 'thinking', 'later', 'refused'] as const;
export type CallOutcome = typeof CALL_OUTCOMES[number];

export const NEXT_KINDS = ['callback', 'meeting', 'step'] as const;
export type NextKind = typeof NEXT_KINDS[number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Следующее действие после звонка / встречи. */
export class NextActionDto {
  @ApiProperty({ enum: [...NEXT_KINDS] }) @IsIn(NEXT_KINDS as unknown as string[])
  kind: NextKind;

  /** ISO-время (браузер шлёт с часовым поясом). */
  @ApiProperty() @IsISO8601()
  at: string;

  /** Текст шага (для kind='step' обязателен — проверяет сервис). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  text?: string;
}

export class CallDto {
  @ApiProperty({ enum: [...CALL_RESULTS] }) @IsIn(CALL_RESULTS as unknown as string[])
  result: CallResult;

  @ApiPropertyOptional({ enum: [...CALL_OUTCOMES] }) @IsOptional() @IsIn(CALL_OUTCOMES as unknown as string[])
  outcome?: CallOutcome;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({ type: NextActionDto }) @IsOptional() @ValidateNested() @Type(() => NextActionDto)
  next?: NextActionDto;
}

export class EmailDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;
}

export class MeetingResultDto {
  @ApiProperty() @IsBoolean()
  held: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({ type: NextActionDto }) @IsOptional() @ValidateNested() @Type(() => NextActionDto)
  next?: NextActionDto;
}

export class CommentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000)
  text: string;
}

export const HANDOFF_DIRECTIONS = ['smm', 'development'] as const;
export type HandoffDirection = typeof HANDOFF_DIRECTIONS[number];

/** «Передать в работу»: что продали и когда клиент платит. */
export class HandoffDto {
  @ApiProperty({ enum: [...HANDOFF_DIRECTIONS] }) @IsIn(HANDOFF_DIRECTIONS as unknown as string[])
  direction: HandoffDirection;

  /** Тариф SMM или тип проекта разработки. */
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200)
  product: string;

  /** Сумма сделки, сомони. */
  @ApiProperty() @Type(() => Number) @IsNumber() @IsPositive() @Max(1e12)
  amount: number;

  /** YYYY-MM-DD по Душанбе. strict — «2026-02-30» не пройдёт. */
  @ApiProperty() @Matches(ISO_DAY) @IsISO8601({ strict: true })
  firstPaymentAt: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  sendBrief?: boolean;
}

export class LinkProjectDto {
  @ApiProperty() @IsUUID()
  projectId: string;
}

/**
 * Настройки продаж. Вложенные объекты свободной формы — значения проверяет
 * сервис (sales-settings.logic.ts): нормы — целые 0..500, комиссия — 0 < p ≤ 100,
 * null/0 у комиссии — снять.
 */
export class SalesSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsObject()
  norms?: Record<string, Record<string, unknown>>;

  @ApiPropertyOptional() @IsOptional() @IsObject()
  commission?: Record<string, unknown>;
}
