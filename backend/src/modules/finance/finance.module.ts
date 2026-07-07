import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceTransaction } from './finance-transaction.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { FinanceCategory } from './entities/finance-category.entity';
import { FinanceProject } from './entities/finance-project.entity';
import { FinanceEmployee } from './entities/finance-employee.entity';
import { FinanceSubscription } from './entities/finance-subscription.entity';
import { FinanceDebt } from './entities/finance-debt.entity';
import { FinancePlannedPayment } from './entities/finance-planned-payment.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { FinanceService } from './finance.service';
import { FinanceScheduler } from './finance.scheduler';
import { FinanceController } from './finance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    FinanceTransaction, FinanceAccount, FinanceCategory,
    FinanceProject, FinanceEmployee, FinanceSubscription, FinanceDebt,
    FinancePlannedPayment, User,
  ]), NotificationsModule, TelegramModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceScheduler],
  exports: [FinanceService],
})
export class FinanceModule {}
