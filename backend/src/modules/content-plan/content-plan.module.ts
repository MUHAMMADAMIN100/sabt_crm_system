import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from './content-plan-item.entity';
import { ContentPlanService } from './content-plan.service';
import { ContentPlanController } from './content-plan.controller';
import { Task } from '../tasks/task.entity';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  // Task репозиторий нужен для авто-создания/синхронизации задач при
  // сохранении элементов контент-плана.
  // GatewayModule — чтобы эмитить tasks:changed после backfill/create/
  // update — фронт мгновенно обновит канбан и календарь без F5.
  imports: [TypeOrmModule.forFeature([ContentPlanItem, Task]), GatewayModule],
  controllers: [ContentPlanController],
  providers: [ContentPlanService],
  exports: [ContentPlanService],
})
export class ContentPlanModule {}
