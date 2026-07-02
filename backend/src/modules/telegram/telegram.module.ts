import { Module, Global, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { Employee } from '../employees/employee.entity';
import { WorkflowModule } from '../workflow/workflow.module';
import { TasksModule } from '../tasks/tasks.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Employee]), forwardRef(() => WorkflowModule), forwardRef(() => TasksModule)],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
