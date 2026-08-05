import { Module, Global, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { VoiceTaskService } from './voice-task.service';
import { Employee } from '../employees/employee.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { TasksModule } from '../tasks/tasks.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Task, User]),
    NotificationsModule,
    forwardRef(() => WorkflowModule),
    forwardRef(() => TasksModule),
  ],
  controllers: [TelegramController],
  providers: [TelegramService, VoiceTaskService],
  exports: [TelegramService],
})
export class TelegramModule {}
