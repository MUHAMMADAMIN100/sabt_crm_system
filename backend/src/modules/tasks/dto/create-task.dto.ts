import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsUUID, IsBoolean, IsArray, Min, Max, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskPriority, TaskStatus, TaskScope } from '../task.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(1) title: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() projectId?: string;
  /** Если true — задача прямая от основателя, шлёт усиленное уведомление
   *  исполнителю и помечается специальным баджем в UI. */
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() fromFounder?: boolean;
  /** Скоуп задачи: personal (только создатель видит), business (default),
   *  general (видит вся компания). Используется основателем для разделения
   *  личных заметок от рабочих задач. */
  @ApiProperty({ enum: TaskScope, required: false }) @IsOptional() @IsEnum(TaskScope) scope?: TaskScope;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() assigneeId?: string;
  /** Multi-assignee — список UUID. Поле необязательное; если задано —
   *  заменяет старое assigneeId (assigneeId в БД будет = первому из списка). */
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() assigneeIds?: string[];
  @ApiProperty({ enum: TaskPriority, required: false }) @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @ApiProperty({ enum: TaskStatus, required: false }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() deadline?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() estimatedHours?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() totalCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() doneCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() returnReason?: string;

  // ─── Wave 3: контроль качества и пайплайн ───────────────────────────
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() reviewerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() reworkCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(1) @Max(10) qualityScore?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() acceptedOnFirstTry?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() actualCompletionHours?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() deliveryType?: string;

  // ─── Технические детали для dev-задач ───────────────────────────────
  /** JSON со ссылками: repoUrl, branch, prUrl, liveUrl, stagingUrl,
   *  localDevPort, sentryUrl, ciStatusUrl. Отображается блоком
   *  "🔧 Технические детали" на странице задачи. */
  @ApiProperty({ required: false }) @IsOptional() techMeta?: {
    repoUrl?: string;
    branch?: string;
    prUrl?: string;
    liveUrl?: string;
    stagingUrl?: string;
    localDevPort?: string;
    sentryUrl?: string;
    ciStatusUrl?: string;
  };

  /** Definition of Done — структурированный чеклист критериев приёмки. */
  @ApiProperty({ required: false }) @IsOptional() acceptanceCriteria?: Array<{
    id: string;
    text: string;
    done: boolean;
    doneBy?: string;
    doneAt?: string;
  }>;

  /** Story points: 1/2/3/5/8/13 (Fibonacci). 0 или null = не оценено. */
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() storyPoints?: number;

  /** Tech tags: frontend/backend/bug/feature/refactor/optimization/tech-debt/urgent. */
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() tags?: string[];

  /** ID задач которые блокируются текущей. */
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() blocksTaskIds?: string[];

  /** ID задач которые блокируют текущую. */
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() blockedByTaskIds?: string[];
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}
