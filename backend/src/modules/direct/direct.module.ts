import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DirectAttachment, DirectConversation, DirectConversationLabel, DirectLabel, DirectMessage, DirectReminder, DirectReply,
  DirectSetting, DirectTemplate,
} from './direct.entity';
import { User } from '../users/user.entity';
import { DirectService } from './direct.service';
import { DirectToolsService } from './direct-tools.service';
import { DirectController } from './direct.controller';
import { DirectWebhookController } from './direct-webhook.controller';
import { DirectFiles } from './direct-files';
import { AudioConverter } from './audio-converter';
import { InstagramApi } from './instagram.api';
import { NotificationsModule } from '../notifications/notifications.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ClientsModule } from '../clients/clients.module';

/** «Директ» — переписка Instagram аккаунта агентства в CRM (04.11.2026). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DirectConversation, DirectMessage, DirectAttachment, DirectReply, DirectSetting, User,
      DirectLabel, DirectConversationLabel, DirectTemplate, DirectReminder,
    ]),
    NotificationsModule,
    GatewayModule,
    ClientsModule,
  ],
  controllers: [DirectController, DirectWebhookController],
  providers: [DirectService, DirectToolsService, DirectFiles, AudioConverter, InstagramApi],
})
export class DirectModule {}
