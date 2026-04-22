import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { join } from 'path';
import { LoggerModule } from './logger/logger.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { CommentsModule } from './modules/comments/comments.module';
import { TimeTrackerModule } from './modules/time-tracker/time-tracker.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FilesModule } from './modules/files/files.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { StoriesModule } from './modules/stories/stories.module';
import { MailModule } from './modules/mail/mail.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TaskResultsModule } from './modules/task-results/task-results.module';
import { TaskChecklistsModule } from './modules/task-checklists/task-checklists.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ProjectAdsModule } from './modules/project-ads/project-ads.module';
import { ProjectAnnouncementsModule } from './modules/project-announcements/project-announcements.module';
import { SmmTariffsModule } from './modules/smm-tariffs/smm-tariffs.module';
import { ContentPlanModule } from './modules/content-plan/content-plan.module';
import { RiskAnalyticsModule } from './modules/risk-analytics/risk-analytics.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        migrations: [join(__dirname, 'database/migrations/*.{ts,js}')],
        synchronize: process.env.NODE_ENV !== 'production',
        migrationsRun: process.env.NODE_ENV === 'production',
        logging: false,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
        poolSize: 5,
        connectTimeoutMS: 10000,
        extra: {
          max: 5,
          min: 1,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        },
      }),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    CacheModule.register({ isGlobal: true, ttl: 300000 }),
    AuthModule,
    UsersModule,
    EmployeesModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    TimeTrackerModule,
    NotificationsModule,
    ReportsModule,
    FilesModule,
    AnalyticsModule,
    CalendarModule,
    GatewayModule,
    StoriesModule,
    MailModule,
    ActivityLogModule,
    TelegramModule,
    TaskResultsModule,
    TaskChecklistsModule,
    AiAssistantModule,
    ClientsModule,
    ProjectAdsModule,
    ProjectAnnouncementsModule,
    SmmTariffsModule,
    ContentPlanModule,
    RiskAnalyticsModule,
  ],
})
export class AppModule {}
