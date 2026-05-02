import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectPayment } from './payment.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/user.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { SmmTariff } from '../smm-tariffs/smm-tariff.entity';
import { ContentPlanModule } from '../content-plan/content-plan.module';
import { Task } from '../tasks/task.entity';
import { Team } from '../teams/team.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, User, ProjectPayment, SmmTariff, Task, Team]),
    NotificationsModule,
    GatewayModule,
    ContentPlanModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
