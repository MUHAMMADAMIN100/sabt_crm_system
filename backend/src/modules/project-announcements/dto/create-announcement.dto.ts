import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementPriority } from '../project-announcement.entity';

export class CreateAnnouncementDto {
  @ApiProperty() @IsString() @MaxLength(300)
  title: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: AnnouncementPriority }) @IsOptional() @IsEnum(AnnouncementPriority)
  priority?: AnnouncementPriority;
}
