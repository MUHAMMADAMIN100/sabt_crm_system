import { Module, Global, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { VoiceTaskService } from './voice-task.service';
import { BotWorkspaceService } from './bot-workspace.service';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { TaskAssignee } from '../tasks/task-assignee.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { CommentsModule } from '../comments/comments.module';
import { TaskResultsModule } from '../task-results/task-results.module';
import { GatewayModule } from '../gateway/gateway.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Task, TaskAssignee, User]),
    NotificationsModule,
    forwardRef(() => TasksModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => TaskResultsModule),
    // Голосовая задача из Telegram шлёт «задачи изменились» (08.11.2026) —
    // иначе на сайте она появлялась только по опросу страницы. Как в
    // content-plan: шлюз импортируем напрямую, он ни от кого не зависит.
    GatewayModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService, VoiceTaskService, BotWorkspaceService],
  exports: [TelegramService],
})
export class TelegramModule {}
