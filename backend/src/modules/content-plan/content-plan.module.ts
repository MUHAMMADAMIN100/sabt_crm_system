import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from './content-plan-item.entity';
import { ShootSession } from './shoot-session.entity';
import { ContentPlanService } from './content-plan.service';
import { ContentPlanController } from './content-plan.controller';
import { Task } from '../tasks/task.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // Task репозиторий нужен для авто-создания/синхронизации задач при
  // сохранении элементов контент-плана.
  // GatewayModule — чтобы эмитить tasks:changed после backfill/create/
  // update — фронт мгновенно обновит канбан и календарь без F5.
  // TelegramModule + NotificationsModule — утренняя сводка производству
  // (кому что снимать/монтировать/рисовать сегодня).
  imports: [
    TypeOrmModule.forFeature([ContentPlanItem, ShootSession, Task]),
    GatewayModule, NotificationsModule,
    // forwardRef: Telegram → Tasks → Projects → ContentPlan замыкается в
    // кольцо. Ленивая ссылка разрывает его, иначе приложение не стартует.
    forwardRef(() => TelegramModule),
  ],
  controllers: [ContentPlanController],
  providers: [ContentPlanService],
  exports: [ContentPlanService],
})
export class ContentPlanModule {}
