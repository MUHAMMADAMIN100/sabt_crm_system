import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty() @IsString() @MaxLength(120)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20)
  color?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  leadId?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}
