import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmmProjectCheck } from './smm-project-check.entity';
import { Project } from '../projects/project.entity';
import { SmmControlService } from './smm-control.service';
import { SmmControlController } from './smm-control.controller';
import { SmmPaymentsService } from './smm-payments.service';
import { SmmPaymentsController } from './smm-payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SmmProjectCheck, Project])],
  providers: [SmmControlService, SmmPaymentsService],
  controllers: [SmmControlController, SmmPaymentsController],
  // Сроки оплат нужны календарю менеджеров. Этот модуль никого не
  // импортирует, поэтому кольца зависимостей здесь быть не может.
  exports: [SmmPaymentsService],
})
export class SmmControlModule {}
