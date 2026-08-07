import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskResult } from './task-result.entity';
import { Task } from '../tasks/task.entity';
import { TaskResultsService } from './task-results.service';
import { TaskResultsController } from './task-results.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [TypeOrmModule.forFeature([TaskResult, Task]), GatewayModule],
  controllers: [TaskResultsController],
  providers: [TaskResultsService],
  exports: [TaskResultsService],
})
export class TaskResultsModule {}
