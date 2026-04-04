import { IsEnum, IsString, IsOptional } from 'class-validator';
import { TaskResultType } from '../task-result.entity';

export class CreateTaskResultDto {
  @IsEnum(TaskResultType)
  type: TaskResultType;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  filePath?: string;
}
