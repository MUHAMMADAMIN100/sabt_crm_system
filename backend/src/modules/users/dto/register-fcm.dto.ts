import { IsString, MaxLength, MinLength } from 'class-validator';

/** Регистрация/удаление FCM-токена устройства мобильного приложения. */
export class RegisterFcmDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token: string;
}
