import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(128)
  oldPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString() @MinLength(8, { message: 'Новый пароль должен содержать минимум 8 символов' }) @MaxLength(128)
  newPassword: string;
}
