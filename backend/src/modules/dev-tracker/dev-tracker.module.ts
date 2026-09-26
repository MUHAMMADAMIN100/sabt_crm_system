import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevTask } from './dev-task.entity';
import { DevTaskComment } from './dev-task-comment.entity';
import { DevTaskHistory } from './dev-task-history.entity';
import { DevSprint } from './dev-sprint.entity';
import { DevBoardView } from './dev-board-view.entity';
import { DevWebhookSubscription } from './dev-webhook-subscription.entity';
import { DevWebhookDelivery } from './dev-webhook-delivery.entity';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { DevTasksService } from './dev-tasks.service';
import { DevTasksController } from './dev-tasks.controller';
import { DevDeadlineScheduler } from './dev-deadline.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  // NotificationsModule — уведомления исполнителю/автору при постановке
  // задачи, смене статуса и комментариях (без них «поставил задачу — а
  // исполнитель не узнал»). GatewayModule — broadcast событий доски,
  // чтобы открытые у команды доски обновлялись без F5.
  imports: [
    TypeOrmModule.forFeature([DevTask, DevTaskComment, DevTaskHistory, DevSprint, DevBoardView, DevWebhookSubscription, DevWebhookDelivery, User, Project]),
    NotificationsModule,
    GatewayModule,
  ],
  controllers: [DevTasksController],
  providers: [DevTasksService, DevDeadlineScheduler],
  exports: [DevTasksService],
})
export class DevTrackerModule {}
