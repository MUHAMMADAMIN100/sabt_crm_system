import {
  IsString, IsOptional, IsDateString, IsIn, IsNotEmpty,
  MinLength, MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { NoCoerce } from './no-coerce.transform';

/** Body для POST /dev-tracker/sprints (контракт H). */
export class CreateSprintDto {
  @ApiProperty({ maxLength: 120 })
  @NoCoerce()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @NoCoerce()
  @IsString()
  @MaxLength(2000)
  goal?: string | null;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  endDate: string;
}

/** Body для PATCH /dev-tracker/sprints/:id (manage).
 *  Все поля опциональны; status — только 'active'|'done', иначе 400. */
export class UpdateSprintDto extends PartialType(CreateSprintDto) {
  @ApiProperty({ required: false, enum: ['active', 'done'] })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'done'])
  status?: string;
}

/** Body для POST /dev-tracker/sprints/:id/complete (manage).
 *  'backlog' = открытые задачи в backlog (sprintId null),
 *  иначе UUID спринта-приёмника (несуществующий → 400). */
export class CompleteSprintDto {
  @ApiProperty({ description: "'backlog' | UUID спринта" })
  @IsString()
  @IsNotEmpty()
  moveTo: string;
}
