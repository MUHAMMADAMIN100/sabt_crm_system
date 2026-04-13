import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskResult } from './task-result.entity';
import { Task } from '../tasks/task.entity';
import { TaskResultsService } from './task-results.service';
import { TaskResultsController } from './task-results.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaskResult, Task])],
  controllers: [TaskResultsController],
  providers: [TaskResultsService],
  exports: [TaskResultsService],
})
export class TaskResultsModule {}
