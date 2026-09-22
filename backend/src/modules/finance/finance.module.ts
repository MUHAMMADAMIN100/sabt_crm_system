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
import { FinanceAsset } from './entities/finance-asset.entity';
import { FinanceBackup } from './entities/finance-backup.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { FinanceService } from './finance.service';
import { FinanceScheduler } from './finance.scheduler';
import { FinanceController } from './finance.controller';
import { MySalaryController } from './my-salary.controller';
import { FinanceActivity } from './entities/finance-activity.entity';
import { FinanceActivityInterceptor } from './finance-activity.interceptor';
import { FinanceForecastAdjustment } from './entities/finance-forecast-adjustment.entity';
import { FinancePayrollPeriod } from './entities/finance-payroll-period.entity';
import { LateFineDecision } from './entities/late-fine-decision.entity';

@Module({
  imports: [TypeOrmModule.forFeature([
    FinanceTransaction, FinanceAccount, FinanceCategory,
    FinanceProject, FinanceEmployee, FinanceSubscription, FinanceDebt,
    FinancePlannedPayment, FinanceAsset, FinanceBackup, FinanceActivity,
    FinanceForecastAdjustment, FinancePayrollPeriod, LateFineDecision, User,
  ]), NotificationsModule, TelegramModule],
  controllers: [FinanceController, MySalaryController],
  providers: [FinanceService, FinanceScheduler, FinanceActivityInterceptor],
  exports: [FinanceService],
})
export class FinanceModule {}
