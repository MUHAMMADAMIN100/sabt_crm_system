import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from './content-plan-item.entity';
import { ShootSession } from './shoot-session.entity';
import { ContentPlanService } from './content-plan.service';
import { ContentPlanController } from './content-plan.controller';
import { Task } from '../tasks/task.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmmAutoPlanScheduler } from './smm-auto-plan.scheduler';

@Module({
  // Task репозиторий нужен для авто-создания/синхронизации задач при
  // сохранении элементов контент-плана.
  // GatewayModule — чтобы эмитить tasks:changed после backfill/create/
  // update — фронт мгновенно обновит канбан и календарь без F5.
  // NotificationsModule — уведомить специалистов, что новый цикл расставлен сам.
  imports: [TypeOrmModule.forFeature([ContentPlanItem, ShootSession, Task]), GatewayModule, NotificationsModule],
  controllers: [ContentPlanController],
  providers: [ContentPlanService, SmmAutoPlanScheduler],
  exports: [ContentPlanService],
})
export class ContentPlanModule {}
