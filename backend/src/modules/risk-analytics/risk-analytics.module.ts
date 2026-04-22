import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskAnalyticsController } from './risk-analytics.controller';
import { RiskAnalyticsService } from './risk-analytics.service';
import { RiskAlertsService } from './risk-alerts.service';
import { RiskAlertsScheduler } from './risk-alerts.scheduler';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Task, ContentPlanItem, SmmTariff, User]),
    NotificationsModule,
    ProjectsModule,
  ],
  controllers: [RiskAnalyticsController],
  providers: [RiskAnalyticsService, RiskAlertsService, RiskAlertsScheduler],
  exports: [RiskAnalyticsService, RiskAlertsService],
})
export class RiskAnalyticsModule {}
