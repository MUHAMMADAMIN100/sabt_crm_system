import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from './content-plan-item.entity';
import { ContentPlanService } from './content-plan.service';
import { ContentPlanController } from './content-plan.controller';
import { Task } from '../tasks/task.entity';

@Module({
  // Task репозиторий нужен для авто-создания/синхронизации задач при
  // сохранении элементов контент-плана.
  imports: [TypeOrmModule.forFeature([ContentPlanItem, Task])],
  controllers: [ContentPlanController],
  providers: [ContentPlanService],
  exports: [ContentPlanService],
})
export class ContentPlanModule {}
