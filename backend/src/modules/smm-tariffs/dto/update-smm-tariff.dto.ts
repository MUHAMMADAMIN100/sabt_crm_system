import { PartialType } from '@nestjs/swagger';
import { CreateSmmTariffDto } from './create-smm-tariff.dto';

export class UpdateSmmTariffDto extends PartialType(CreateSmmTariffDto) {}
