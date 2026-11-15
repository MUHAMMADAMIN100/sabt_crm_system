import {
  Allow, IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ClientLeadStatus, ClientLeadInterest, ClientLeadDirection, LEAD_STATUSES_SETTABLE, LOST_REASONS, LostReason,
} from '../client-lead.entity';

/** Тип звонка и статус письма — закрытые списки (15.11.2026): раньше
 *  принималась любая строка, и «Cold» с большой буквы молча не шёл в KPI. */
export const CALL_TYPES = ['cold', 'neutral', 'hot', 'repeat'] as const;
export const EMAIL_STATUSES = ['sent', 'answered', 'no_reply', 'rejected'] as const;

export class CreateClientDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  sphere?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  problem?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  contactInfo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  contactPhone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  contactInstagram?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  contactEmail?: string;

  /** Этап единой воронки (15.11.2026). Устаревшие negotiating / on_hold /
   *  unknown не принимаем — их перенесла миграция 1835. */
  @ApiPropertyOptional({ enum: [...LEAD_STATUSES_SETTABLE] })
  @IsOptional()
  @IsIn([...LEAD_STATUSES_SETTABLE], { message: 'Неизвестный этап воронки' })
  status?: ClientLeadStatus;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  nextStep?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  leadSource?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  dealPotential?: number;

  @ApiPropertyOptional({ enum: ClientLeadInterest }) @IsOptional() @IsEnum(ClientLeadInterest)
  interest?: ClientLeadInterest;

  /** Направление задаётся сервером по сегменту менеджера, но пускаем
   *  значение в DTO чтобы admin/founder мог явно указать. Сервис может
   *  переопределить. */
  @ApiPropertyOptional({ enum: ClientLeadDirection }) @IsOptional() @IsEnum(ClientLeadDirection)
  direction?: ClientLeadDirection;

  /** «Этап онбординга» больше не пишется (15.11.2026, единая воронка):
   *  поле принимаем, чтобы старый экран не получал 400 (forbidNonWhitelisted),
   *  но сервис его отбрасывает. */
  @ApiHideProperty() @IsOptional() @Allow()
  onboardingStage?: unknown;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  lastContactAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  nextContactAt?: string;

  /** Дата+время повторного звонка — отдельно от встречи. Очищается передачей
   *  null (форма шлёт именно null, когда менеджер снял напоминание);
   *  пустая строка не является валидной датой и будет отклонена. */
  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  repeatCallAt?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  channel?: string;

  /** Тип звонка для KPI «Холодные звонки». Селект в форме клиента —
   *  Холодный / Нейтральный / Горячий / Повторный звонок. Считается KPI
   *  только когда 'cold' (повторный на KPI не влияет). */
  @ApiPropertyOptional({ enum: [...CALL_TYPES] })
  @IsOptional() @IsIn([...CALL_TYPES], { message: 'Тип звонка: cold, neutral, hot или repeat' })
  callType?: 'cold' | 'neutral' | 'hot' | 'repeat';

  /** Статус персонального письма для KPI «Персональные письма».
   *   sent — «Написал» (+1 в KPI за сегодня)
   *   answered — «Ответили»
   *   no_reply — «Не ответили»
   *   rejected — «Отказ» */
  @ApiPropertyOptional({ enum: [...EMAIL_STATUSES] })
  @IsOptional() @IsIn([...EMAIL_STATUSES], { message: 'Статус письма: sent, answered, no_reply или rejected' })
  emailStatus?: 'sent' | 'answered' | 'no_reply' | 'rejected';

  /** Текст причины проигрыша; для lostReason = 'other' обязателен. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  rejectionReason?: string;

  /** Владелец. Правила (кому можно передать) — lead-access.ts; null —
   *  «без владельца» (ставит только руководство). */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('all', { message: 'ownerId — id сотрудника' })
  ownerId?: string | null;

  // ─── Продажи, этап 2 (15.11.2026) ─────────────────────────────────────

  /** «На паузе» — флаг поверх этапа. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  onHold?: boolean;

  /** Срок следующего шага (текст — nextStep). null — снять. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601()
  nextStepAt?: string | null;

  /** Вероятность сделки, %; null — по этапу. */
  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  probability?: number | null;

  /** Ожидаемая дата закрытия, YYYY-MM-DD по Душанбе. */
  @ApiPropertyOptional({ nullable: true, example: '2026-12-01' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expectedCloseAt — дата ГГГГ-ММ-ДД' })
  expectedCloseAt?: string | null;

  /** Причина проигрыша — обязательна для status = lost. */
  @ApiPropertyOptional({ enum: [...LOST_REASONS], nullable: true })
  @IsOptional() @IsIn([...LOST_REASONS], { message: 'Неизвестная причина проигрыша' })
  lostReason?: LostReason | null;

  /** Создать, даже если нашлись похожие лиды (ответ 409 duplicate). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  force?: boolean;
}
