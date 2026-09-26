import { IsString, MinLength, MaxLength, IsOptional, IsArray, IsUUID, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NoCoerce } from './no-coerce.transform';

export class CommentDevTaskDto {
  @ApiProperty({ maxLength: 5000 })
  @NoCoerce()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text: string;

  /** Упомянутые пользователи (UUID). Санитизируются в сервисе: массив UUID, max 20.
   *  Упомянутые (кроме автора) получают уведомление task_comment. */
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mentions?: string[];
}
