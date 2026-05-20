import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientLead } from './client-lead.entity';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { Task } from '../tasks/task.entity';

@Module({
  // Task entity подключён сюда, чтобы ClientsService мог авто-создавать
  // личные задачи-встречи при установке nextContactAt у лида.
  imports: [TypeOrmModule.forFeature([ClientLead, Task])],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
