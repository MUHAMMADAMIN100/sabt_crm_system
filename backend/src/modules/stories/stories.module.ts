import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoryLog } from './story.entity';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StoryLog, Project, User]),
    NotificationsModule,
    TelegramModule,
    ActivityLogModule,
    GatewayModule,
  ],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
