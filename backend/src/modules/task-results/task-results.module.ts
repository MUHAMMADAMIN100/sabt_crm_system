import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskResult } from './task-result.entity';
import { TaskResultsService } from './task-results.service';
import { TaskResultsController } from './task-results.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaskResult])],
  controllers: [TaskResultsController],
  providers: [TaskResultsService],
  exports: [TaskResultsService],
})
export class TaskResultsModule {}
