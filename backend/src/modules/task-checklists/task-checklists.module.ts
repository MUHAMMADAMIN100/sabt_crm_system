import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { Task } from '../tasks/task.entity';
import { TaskChecklistsService } from './task-checklists.service';
import { TaskChecklistsController } from './task-checklists.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaskChecklistItem, Task])],
  controllers: [TaskChecklistsController],
  providers: [TaskChecklistsService],
  exports: [TaskChecklistsService],
})
export class TaskChecklistsModule {}
