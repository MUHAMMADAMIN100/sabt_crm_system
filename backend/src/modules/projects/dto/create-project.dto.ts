import { IsString, IsOptional, IsEnum, IsDateString, IsArray, IsNumber, IsUUID, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProjectStatus } from '../project.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProjectDto {
  @ApiProperty() @IsString() @MinLength(1) name: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() managerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startDate?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() endDate?: string;
  @ApiProperty({ enum: ProjectStatus, required: false }) @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() color?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() budget?: number;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() memberIds?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() projectType?: string;
  @ApiProperty({ required: false }) @IsOptional() smmData?: Record<string, any>;
  @ApiProperty({ required: false }) @IsOptional() clientInfo?: Record<string, any>;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
