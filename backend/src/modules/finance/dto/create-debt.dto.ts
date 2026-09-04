import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDebtDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  counterparty?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  paidBefore?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  monthlyPayment?: number;

  @ApiPropertyOptional({ example: 10, description: 'День месяца планового погашения (1..31)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dueDay?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}
