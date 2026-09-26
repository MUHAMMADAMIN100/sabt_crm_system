import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NoCoerce } from './no-coerce.transform';

export enum BulkDevTaskAction {
  STATUS = 'status',
  PRIORITY = 'priority',
  ASSIGNEE = 'assignee',
  DEADLINE = 'deadline',
  /** Блокировка (контракт A): value '' = снять, иначе строка-причина
   *  (trim, max 500 → 400 если длиннее). */
  BLOCKED = 'blocked',
  DELETE = 'delete',
}

export class BulkDevTaskDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];

  @ApiProperty({ enum: BulkDevTaskAction })
  @IsEnum(BulkDevTaskAction)
  action: BulkDevTaskAction;

  @ApiProperty({ required: false })
  @IsOptional()
  @NoCoerce()
  @IsString()
  value?: string;
}
