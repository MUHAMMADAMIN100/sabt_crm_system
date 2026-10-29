import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProducerService } from './producer.service';
import { ProducerController, PublicScriptController } from './producer.controller';

/** Продюсер: панель съёмок, Telegram накануне и по субботам, сценарий по
 *  ссылке. Отдельный модуль — чтобы Telegram не попадал в зависимости
 *  ContentPlanModule и не замыкал кольцо модулей (как ProductionDigestModule). */
@Module({
  imports: [TelegramModule, NotificationsModule],
  controllers: [ProducerController, PublicScriptController],
  providers: [ProducerService],
})
export class ProducerModule {}
