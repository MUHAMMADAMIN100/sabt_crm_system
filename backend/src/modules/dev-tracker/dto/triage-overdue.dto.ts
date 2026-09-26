import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Body для POST /dev-tracker/triage-overdue (контракт C).
 *  Оба поля optional: assigneeId default — текущий пользователь (req.user.id),
 *  projectId — скоуп триажа одним проектом (без него — все проекты). */
export class TriageOverdueDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}
