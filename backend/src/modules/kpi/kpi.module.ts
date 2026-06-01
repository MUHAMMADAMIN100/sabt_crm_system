import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { WorkSession } from '../auth/work-session.entity';
import { StoryLog } from '../stories/story.entity';
import { Project } from '../projects/project.entity';
import { ClientsModule } from '../clients/clients.module';

/**
 * Wave 13 — KPI всех сотрудников.
 * Универсальные 4 метрики (задач выполнено / часов / соблюдено
 * дедлайнов / активных дней) + бонусы по роли (МП — funnel-метрики,
 * SMM — stories, PM — проектов под управлением).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Employee, Task, WorkSession, StoryLog, Project]),
    ClientsModule,
  ],
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
