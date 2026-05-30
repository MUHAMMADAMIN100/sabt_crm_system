import { PartialType } from '@nestjs/swagger';
import { CreateProjectAdDto } from './create-project-ad.dto';

export class UpdateProjectAdDto extends PartialType(CreateProjectAdDto) {}
