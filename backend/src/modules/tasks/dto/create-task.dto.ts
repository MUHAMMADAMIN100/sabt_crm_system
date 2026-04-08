import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskPriority, TaskStatus } from '../task.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTaskDto {
  @ApiProperty() @IsString() title: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsUUID() projectId: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() assigneeId?: string;
  @ApiProperty({ enum: TaskPriority, required: false }) @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @ApiProperty({ enum: TaskStatus, required: false }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() deadline?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() estimatedHours?: number;
<<<<<<< HEAD
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() totalCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() doneCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() returnReason?: string;
=======
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() targetCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() completedCount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() returnComment?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() resultUrl?: string;
>>>>>>> b37de1a (add manager field + fix task assignee logic)
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}
