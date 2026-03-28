import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';

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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        synchronize: true,
        logging: false,
      }),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
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
  ],
})
export class AppModule {}
