import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectAnnouncement } from './project-announcement.entity';
import { Project } from '../projects/project.entity';
import { ProjectAnnouncementsService } from './project-announcements.service';
import { ProjectAnnouncementsController } from './project-announcements.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectAnnouncement, Project]),
    NotificationsModule,
    MailModule,
    TelegramModule,
  ],
  controllers: [ProjectAnnouncementsController],
  providers: [ProjectAnnouncementsService],
})
export class ProjectAnnouncementsModule {}
