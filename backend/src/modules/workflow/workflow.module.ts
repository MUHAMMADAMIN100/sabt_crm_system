import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowCard } from './workflow-card.entity';
import { ShootSession } from './shoot-session.entity';
import { UnitEvent } from './unit-event.entity';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowCard, ShootSession, UnitEvent, Project, User, SmmTariff]),
    GatewayModule,
    NotificationsModule,
    // TelegramService доступен глобально (@Global TelegramModule).
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
