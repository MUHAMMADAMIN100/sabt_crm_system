import { PartialType } from '@nestjs/mapped-types';
import { CreateDevTaskDto } from './create-dev-task.dto';

/** Все поля опциональны — PATCH обновляет только переданное. */
export class UpdateDevTaskDto extends PartialType(CreateDevTaskDto) {}
