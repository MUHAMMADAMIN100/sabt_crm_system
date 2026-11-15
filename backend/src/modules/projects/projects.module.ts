import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectPayment } from './payment.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PublicBriefController } from './public-brief.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { ContentPlanModule } from '../content-plan/content-plan.module';
import { Task } from '../tasks/task.entity';
import { Team } from '../teams/team.entity';
import { Employee } from '../employees/employee.entity';
import { SmmControlModule } from '../smm-control/smm-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, User, ProjectPayment, SmmTariff, Task, Team, Employee]),
    NotificationsModule,
    GatewayModule,
    ContentPlanModule,
    // Долг клиента по «Финансам» для запроса оплаты (15.11.2026). SmmControlModule
    // никого не импортирует — кольца зависимостей нет.
    SmmControlModule,
  ],
  controllers: [ProjectsController, PublicBriefController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
