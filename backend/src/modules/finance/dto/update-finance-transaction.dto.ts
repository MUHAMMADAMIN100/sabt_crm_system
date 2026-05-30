import { PartialType } from '@nestjs/swagger';
import { CreateFinanceTransactionDto } from './create-finance-transaction.dto';

export class UpdateFinanceTransactionDto extends PartialType(CreateFinanceTransactionDto) {}
