import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsUUID, IsBoolean, Min, Max, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskPriority, TaskStatus } from '../task.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(1) title: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsUUID() projectId: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() assigneeId?: string;
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
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}
