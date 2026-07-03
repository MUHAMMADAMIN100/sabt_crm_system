import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FinanceCategoryKind {
  INCOME = 'income',
  EXPENSE = 'expense',
  SAVING = 'saving',
}

export class CreateCategoryDto {
  @ApiProperty() @IsString() @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ enum: FinanceCategoryKind }) @IsOptional() @IsEnum(FinanceCategoryKind)
  type?: FinanceCategoryKind;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16)
  color?: string;
}
