import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectAd } from './project-ad.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { ProjectAdsService } from './project-ads.service';
import { ProjectAdsController } from './project-ads.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectAd, Project, User]),
    GatewayModule,
    NotificationsModule,
    MailModule,
    TelegramModule,
  ],
  controllers: [ProjectAdsController],
  providers: [ProjectAdsService],
  exports: [ProjectAdsService],
})
export class ProjectAdsModule {}
