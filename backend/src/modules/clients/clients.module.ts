import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientLead } from './client-lead.entity';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { Task } from '../tasks/task.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { User } from '../users/user.entity';
import { Employee } from '../employees/employee.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // Task entity подключён сюда, чтобы ClientsService мог авто-создавать
  // личные задачи-встречи при установке nextContactAt у лида.
  // ActivityLog — для KPI продаж (Wave 11): пишем LEAD_PROGRESS и читаем для счёта.
  // User + Employee — для bulk-KPI всех МП (Wave 12): подтягиваем список
  // менеджеров продаж и их employee-карточки одним запросом.
  // GatewayModule — для real-time broadcast 'leads:changed' при движениях
  // по воронке / обновлении лида (KPI инвалидируются у всех онлайн-юзеров).
  imports: [
    TypeOrmModule.forFeature([ClientLead, Task, ActivityLog, User, Employee]),
    ActivityLogModule,
    GatewayModule,
    NotificationsModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
