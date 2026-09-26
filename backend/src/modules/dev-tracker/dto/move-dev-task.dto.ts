import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DevTaskStatus } from '../dev-task.entity';

export class MoveDevTaskDto {
  @ApiProperty({ enum: DevTaskStatus })
  @IsEnum(DevTaskStatus)
  status: DevTaskStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
