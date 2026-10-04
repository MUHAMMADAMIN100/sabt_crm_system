import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmmProjectCheck } from './smm-project-check.entity';
import { Project } from '../projects/project.entity';
import { SmmControlService } from './smm-control.service';
import { SmmControlController } from './smm-control.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SmmProjectCheck, Project])],
  providers: [SmmControlService],
  controllers: [SmmControlController],
})
export class SmmControlModule {}
