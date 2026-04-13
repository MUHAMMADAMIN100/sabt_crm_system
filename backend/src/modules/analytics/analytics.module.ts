import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { TimeLog } from '../time-tracker/time-log.entity';
import { DailyReport } from '../reports/daily-report.entity';
import { Employee } from '../employees/employee.entity';
import { SalaryHistory } from '../employees/salary-history.entity';
import { ProjectPayment } from '../projects/payment.entity';
import { WorkSession } from '../auth/work-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Task, Project, User, TimeLog, DailyReport, Employee, WorkSession, SalaryHistory, ProjectPayment])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
