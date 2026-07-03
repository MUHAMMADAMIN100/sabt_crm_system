import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceSubscriptionKind {
  RENT = 'rent',
  SUBSCRIPTION = 'subscription',
}

export class CreateSubscriptionDto {
  @ApiProperty() @IsString() @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ enum: FinanceSubscriptionKind }) @IsOptional() @IsEnum(FinanceSubscriptionKind)
  kind?: FinanceSubscriptionKind;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  amount?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;
}
