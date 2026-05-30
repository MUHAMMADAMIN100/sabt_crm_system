import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Сброс пароля админом. newPassword опционален: если пустой —
 *  сгенерируем случайный и вернём в ответе (показать админу один раз). */
export class ResetUserPasswordDto {
  @ApiPropertyOptional({ description: 'Новый пароль; если не задан — будет сгенерирован' })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128)
  newPassword?: string;
}
