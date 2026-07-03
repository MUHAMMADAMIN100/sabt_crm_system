import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty() @IsString() @MaxLength(120)
  name: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber()
  startBalance?: number;
}
