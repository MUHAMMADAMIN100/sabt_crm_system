import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from '../content-plan/content-plan-item.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionDigestService } from './production-digest.service';

/** Утренняя сводка производству. Отдельный модуль — чтобы Telegram не
 *  попадал в зависимости ContentPlanModule и не замыкал кольцо модулей.
 *  Ничего не экспортирует и никем не импортируется, кроме AppModule. */
@Module({
  imports: [TypeOrmModule.forFeature([ContentPlanItem]), TelegramModule, NotificationsModule],
  providers: [ProductionDigestService],
})
export class ProductionDigestModule {}
