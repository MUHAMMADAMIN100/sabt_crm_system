import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientLead } from './client-lead.entity';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { Task } from '../tasks/task.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  // Task entity подключён сюда, чтобы ClientsService мог авто-создавать
  // личные задачи-встречи при установке nextContactAt у лида.
  // ActivityLog нужен для KPI продаж (Wave 11): мы пишем сюда LEAD_PROGRESS
  // и читаем обратно для подсчёта продвижений по воронке.
  imports: [
    TypeOrmModule.forFeature([ClientLead, Task, ActivityLog]),
    ActivityLogModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
