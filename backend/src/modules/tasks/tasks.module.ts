import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { DeadlineScheduler } from './deadline.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), NotificationsModule, ProjectsModule],
  controllers: [TasksController],
  providers: [TasksService, DeadlineScheduler],
  exports: [TasksService],
})
export class TasksModule {}
