import {
  IsString, IsOptional, IsEnum, IsDateString, IsInt, IsUUID, IsBoolean,
  IsArray, IsNotEmpty, Min, MinLength, MaxLength, Max, ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DevTaskPriority, DevTaskStatus, DevTaskType } from '../dev-task.entity';
import { NoCoerce } from './no-coerce.transform';

export class CreateDevTaskDto {
  @ApiProperty() @NoCoerce() @IsString() @MinLength(1) @MaxLength(200) @IsNotEmpty() title: string;

  @ApiProperty({ required: false }) @IsOptional() @NoCoerce() @IsString() @MaxLength(10000) description?: string;

  @ApiProperty({ enum: DevTaskStatus, required: false }) @IsOptional() @IsEnum(DevTaskStatus) status?: DevTaskStatus;

  @ApiProperty({ enum: DevTaskPriority, required: false }) @IsOptional() @IsEnum(DevTaskPriority) priority?: DevTaskPriority;

  @ApiProperty({ enum: DevTaskType, required: false }) @IsOptional() @IsEnum(DevTaskType) taskType?: DevTaskType;

  @ApiProperty({ required: false }) @IsOptional() @IsUUID() assigneeId?: string;

  /** id родительской задачи — если задано, создаётся подзадача.
   *  null/undefined — задача верхнего уровня. Вложенность максимум 1 уровень
   *  проверяет сервис. @IsOptional() пропускает валидацию и для null, поэтому
   *  отдельный @IsNullable() не нужен (в class-validator его нет). */
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsUUID() parentTaskId?: string | null;

  /** Проект «Разработка», к которому привязана задача (/dev/projects).
   *  null — задача вне проектов (общая для команды). */
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsUUID() projectId?: string | null;

  /** Позиция карточки в колонке. Обычно вычисляет фронт (в конец колонки),
   *  но разрешаем задать явно при создании. */
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) position?: number;

  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(100) storyPoints?: number;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiProperty({ required: false }) @IsOptional() @IsDateString() deadline?: string;

  /** Дата начала работы (контракт B). null — очистить. В update идёт через
   *  PartialType: PATCH {startDate} конвертируется в Date в сервисе. */
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() startDate?: string | null;

  /** Блокер (контракт A): флаг + причина (trim, max 500 — длиннее даст 400). */
  @ApiProperty({ required: false }) @IsOptional() @NoCoerce() @IsBoolean() isBlocked?: boolean;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @NoCoerce()
  @IsString()
  @MaxLength(500)
  blockedReason?: string | null;

  /** Спринт доски (контракт H). null — отвязать (в backlog вне спринтов). */
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsUUID() sprintId?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  attachments?: string[];
}
