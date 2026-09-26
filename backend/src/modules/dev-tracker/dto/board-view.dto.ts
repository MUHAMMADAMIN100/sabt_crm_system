import {
  IsString, IsOptional, IsObject, IsIn, MinLength, MaxLength, IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NoCoerce } from './no-coerce.transform';

/** Body для POST /dev-tracker/views (контракт D).
 *  filters бэк хранит непрозрачно (любой объект, трактует фронт);
 *  groupBy — строго status/priority/assignee, иначе 400. */
export class CreateBoardViewDto {
  @ApiProperty({ maxLength: 100 })
  @NoCoerce()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;

  @ApiProperty({ required: false, enum: ['status', 'priority', 'assignee'] })
  @IsOptional()
  @NoCoerce()
  @IsString()
  @IsIn(['status', 'priority', 'assignee'])
  groupBy?: string;
}
