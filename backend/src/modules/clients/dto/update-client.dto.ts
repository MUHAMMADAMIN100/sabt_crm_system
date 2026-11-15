import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto';

/** force — только при создании (проверка дублей), в правке его нет. */
export class UpdateClientDto extends PartialType(OmitType(CreateClientDto, ['force'] as const)) {}
