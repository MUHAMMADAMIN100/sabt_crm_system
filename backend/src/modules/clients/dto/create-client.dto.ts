import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ClientLeadStatus, ClientLeadInterest, ClientLeadDirection, ClientLeadOnboardingStage,
} from '../client-lead.entity';

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

  @ApiPropertyOptional({ enum: ClientLeadStatus }) @IsOptional() @IsEnum(ClientLeadStatus)
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

  @ApiPropertyOptional({ enum: ClientLeadOnboardingStage }) @IsOptional() @IsEnum(ClientLeadOnboardingStage)
  onboardingStage?: ClientLeadOnboardingStage;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  lastContactAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  nextContactAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  channel?: string;

  /** Тип звонка для KPI «Холодные звонки». Селект в форме клиента —
   *  Холодный / Нейтральный / Горячий / Повторный звонок. Считается KPI
   *  только когда 'cold' (повторный на KPI не влияет). */
  @ApiPropertyOptional({ enum: ['cold', 'neutral', 'hot', 'repeat'] })
  @IsOptional() @IsString() @MaxLength(20)
  callType?: 'cold' | 'neutral' | 'hot' | 'repeat';

  /** Статус персонального письма для KPI «Персональные письма».
   *   sent — «Написал» (+1 в KPI за сегодня)
   *   answered — «Ответили»
   *   no_reply — «Не ответили»
   *   rejected — «Отказ» */
  @ApiPropertyOptional({ enum: ['sent', 'answered', 'no_reply', 'rejected'] })
  @IsOptional() @IsString() @MaxLength(20)
  emailStatus?: 'sent' | 'answered' | 'no_reply' | 'rejected';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  rejectionReason?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ownerId?: string;
}
