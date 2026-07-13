import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  /** Архивный счёт скрывается из карточек и селектов, история цела. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  archived?: boolean;
}
