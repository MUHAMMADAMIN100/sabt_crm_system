import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { ClientLead } from '../clients/client-lead.entity';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task, Project, ClientLead])],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
