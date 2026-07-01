import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceTransaction } from './finance-transaction.entity';
import { FinanceSubscription } from './finance-subscription.entity';
import { FinanceDebt } from './finance-debt.entity';
import { FinancePlannedPayment } from './finance-planned-payment.entity';
import { FinanceSetting } from './finance-setting.entity';
import { Project } from '../projects/project.entity';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    FinanceTransaction, FinanceSubscription, FinanceDebt, FinancePlannedPayment, FinanceSetting, Project,
  ])],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
