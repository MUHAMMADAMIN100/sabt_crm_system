import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPlanItem } from './content-plan-item.entity';
import { ContentPlanService } from './content-plan.service';
import { ContentPlanController } from './content-plan.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ContentPlanItem])],
  controllers: [ContentPlanController],
  providers: [ContentPlanService],
  exports: [ContentPlanService],
})
export class ContentPlanModule {}
