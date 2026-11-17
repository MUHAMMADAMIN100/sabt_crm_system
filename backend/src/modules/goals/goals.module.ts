import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiModule } from '../kpi/kpi.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfileStatsModule } from '../profile-stats/profile-stats.module';
import { EmployeeGoal } from '../profile-stats/employee-goal.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { GoalCheckin, GoalInitiative, GoalKeyResult, GoalObjective, GoalSetting } from './goal.entity';
import { GoalsController } from './goals.controller';
import { GoalsScheduler } from './goals.scheduler';
import { GoalsService } from './goals.service';

/**
 * «Компас компании» (16.11.2026): каскад целей компания → отдел →
 * сотрудник. Цели месяца сотрудников и их цифры берёт у ProfileStatsModule
 * (зависимость в одну сторону: профиль о компасе не знает, а общие правила
 * отделов и источников цифр — простые файлы departments.ts и goal-sources.ts).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GoalObjective, GoalKeyResult, GoalCheckin, GoalInitiative, GoalSetting, EmployeeGoal]),
    KpiModule,
    ProfileStatsModule,
    NotificationsModule,
    TelegramModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService, GoalsScheduler],
  exports: [GoalsService],
})
export class GoalsModule {}
