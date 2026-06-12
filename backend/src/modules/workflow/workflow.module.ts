import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowCard } from './workflow-card.entity';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { Project } from '../projects/project.entity';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowCard, Project]),
    GatewayModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
