import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class BlockUserDto {
  @ApiPropertyOptional({ description: 'Причина блокировки (видна пользователю при попытке входа)' })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
