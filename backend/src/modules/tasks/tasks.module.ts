import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { Project } from '../projects/project.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { DeadlineScheduler } from './deadline.scheduler';
import { GatewayModule } from '../gateway/gateway.module';
import { TaskResultsModule } from '../task-results/task-results.module';

@Module({
  imports: [TypeOrmModule.forFeature([Task, User, Employee, ActivityLog, Project, DailyReport]), NotificationsModule, ProjectsModule, GatewayModule, TaskResultsModule],
  controllers: [TasksController],
  providers: [TasksService, DeadlineScheduler],
  exports: [TasksService],
})
export class TasksModule {}
