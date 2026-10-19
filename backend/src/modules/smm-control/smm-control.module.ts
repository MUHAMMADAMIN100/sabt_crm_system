import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmmProjectCheck } from './smm-project-check.entity';
import { Project } from '../projects/project.entity';
import { SmmControlService } from './smm-control.service';
import { SmmControlController } from './smm-control.controller';
import { SmmPaymentsService } from './smm-payments.service';
import { SmmPaymentsController } from './smm-payments.controller';
import { SalesPlan } from './sales-plan.entity';
import { SalesPlanService } from './sales-plan.service';
import { SalesPlanController } from './sales-plan.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SmmProjectCheck, Project, SalesPlan])],
  providers: [SmmControlService, SmmPaymentsService, SalesPlanService],
  controllers: [SmmControlController, SmmPaymentsController, SalesPlanController],
  // Сроки оплат нужны календарю менеджеров. Этот модуль никого не
  // импортирует, поэтому кольца зависимостей здесь быть не может.
  exports: [SmmPaymentsService],
})
export class SmmControlModule {}
