import {
  IsString, IsOptional, IsArray, IsBoolean, IsUUID,
  ArrayNotEmpty, MaxLength, IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NoCoerce } from './no-coerce.transform';

/** Body для POST /dev-tracker/webhooks (контракт E, право manage).
 *  Тонкую валидацию (http/https-протокол, подмножество событий) делает
 *  сервис — декораторы здесь дают 400 на грубые нарушения формы. */
export class CreateWebhookDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @ApiProperty({ maxLength: 2000 })
  @NoCoerce()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  url: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @NoCoerce()
  @IsString()
  @MaxLength(500)
  secret?: string | null;

  @ApiProperty({ type: [String], example: ['task.done'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @NoCoerce()
  @IsBoolean()
  isActive?: boolean;
}
