import {
  IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ContentApprovalStatus, ContentItemType, ContentPlanStatus,
} from '../content-plan-item.entity';

export class CreateContentPlanDto {
  @ApiProperty() @IsUUID()
  projectId: string;

  @ApiPropertyOptional({ enum: ContentItemType }) @IsOptional() @IsEnum(ContentItemType)
  contentType?: ContentItemType;

  @ApiProperty() @IsString() @MaxLength(300)
  topic: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  format?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  preparationDeadline?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601()
  publishDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  pmId?: string;

  @ApiPropertyOptional({ enum: ContentPlanStatus }) @IsOptional() @IsEnum(ContentPlanStatus)
  status?: ContentPlanStatus;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  fileLink?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000)
  caption?: string;

  @ApiPropertyOptional({ enum: ContentApprovalStatus }) @IsOptional() @IsEnum(ContentApprovalStatus)
  approvalStatus?: ContentApprovalStatus;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  comments?: string;
}
