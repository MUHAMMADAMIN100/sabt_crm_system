import { IsArray, IsOptional, IsUUID, ArrayMaxSize, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';

class UpdateProjectBase extends PartialType(CreateProjectDto) {}

/** PATCH /projects/:id — состав dev-проекта.
 *  Только ужесточение валидации managerId/memberIds (additive):
 *  - managerId: UUID | null (снять) | undefined (не менять);
 *  - memberIds: массив UUID, max 30, дедуп в сервисе;
 *  undefined ≠ [] ([] — очистить состав).
 *  SMM-поля наследуются без изменений. */
export class UpdateProjectDto extends UpdateProjectBase {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  managerId?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @ValidateIf(o => o.memberIds !== undefined)
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID(undefined, { each: true })
  memberIds?: string[];
}
