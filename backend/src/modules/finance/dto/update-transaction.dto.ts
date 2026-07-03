import { PartialType } from '@nestjs/swagger';
import { CreateOperationDto } from './create-operation.dto';

/** Патч операции журнала. Все поля опциональны. */
export class UpdateTransactionDto extends PartialType(CreateOperationDto) {}
