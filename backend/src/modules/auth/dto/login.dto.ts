import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(4)
  password: string;

  /** TOTP-код из приложения-аутентификатора, если у пользователя
   *  включена 2FA. Frontend отправляет этот код после того, как backend
   *  при первой попытке вернул `2FA_REQUIRED`. */
  @ApiPropertyOptional({ description: '6-значный код 2FA, если у пользователя включена двухфакторная аутентификация' })
  @IsOptional() @IsString() @Length(6, 8)
  twoFactorCode?: string;
}
