import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { ClientLead } from '../clients/client-lead.entity';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { SmmControlModule } from '../smm-control/smm-control.module';

@Module({
  // SmmControlModule — сроки оплат клиентов для менеджеров (сам он никого не
  // импортирует, кольца зависимостей нет).
  imports: [TypeOrmModule.forFeature([Task, Project, ClientLead]), SmmControlModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
