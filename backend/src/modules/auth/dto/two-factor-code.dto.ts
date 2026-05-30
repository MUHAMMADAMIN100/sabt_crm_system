import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Поле кода для enable2FA / disable2FA. */
export class TwoFactorCodeDto {
  @ApiProperty({ description: '6-значный код из приложения-аутентификатора' })
  @IsString() @Length(6, 8)
  code: string;
}
