import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Одноразовый токен из email-ссылки' })
  @IsString() @MinLength(32) @MaxLength(128)
  token: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @MinLength(8, { message: 'Пароль должен содержать минимум 8 символов' }) @MaxLength(128)
  newPassword: string;
}
