import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { SmmDailyService } from './smm-daily.service';
import { SmmDailyScheduler } from './smm-daily.scheduler';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { WorkSession } from '../auth/work-session.entity';
import { StoryLog } from '../stories/story.entity';
import { Project } from '../projects/project.entity';
import { ClientLead } from '../clients/client-lead.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { ClientsModule } from '../clients/clients.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Wave 13 — KPI всех сотрудников.
 * Универсальные 4 метрики (задач выполнено / часов / соблюдено
 * дедлайнов / активных дней) + бонусы по роли (МП — funnel-метрики,
 * SMM — stories, PM — проектов под управлением).
 *
 * + Ежедневный автоотчёт СММ для основателя (SmmDailyService/Scheduler):
 * активность каждого СММ-сотрудника за день из журналов доски/историй/задач.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Employee, Task, WorkSession, StoryLog, Project, ClientLead, ActivityLog]),
    ClientsModule,
    NotificationsModule,
  ],
  controllers: [KpiController],
  providers: [KpiService, SmmDailyService, SmmDailyScheduler],
  exports: [KpiService],
})
export class KpiModule {}
