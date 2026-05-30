import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../user.entity';

/** PATCH /users/:id. Только админ/основатель/сооснователь.
 *  Любые поля кроме перечисленных будут отвергнуты ValidationPipe
 *  (forbidNonWhitelisted: true). */
export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}
