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
import { WorkflowModule } from '../workflow/workflow.module';
import { TasksModule } from '../tasks/tasks.module';
import { CommentsModule } from '../comments/comments.module';
import { TaskResultsModule } from '../task-results/task-results.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Task, TaskAssignee, User]),
    NotificationsModule,
    forwardRef(() => WorkflowModule),
    forwardRef(() => TasksModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => TaskResultsModule),
  ],
  controllers: [TelegramController],
  providers: [TelegramService, VoiceTaskService, BotWorkspaceService],
  exports: [TelegramService],
})
export class TelegramModule {}
