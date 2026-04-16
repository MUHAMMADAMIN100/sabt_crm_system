import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectAd } from './project-ad.entity';
import { Project } from '../projects/project.entity';
import { ProjectAdsService } from './project-ads.service';
import { ProjectAdsController } from './project-ads.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectAd, Project]), GatewayModule],
  controllers: [ProjectAdsController],
  providers: [ProjectAdsService],
  exports: [ProjectAdsService],
})
export class ProjectAdsModule {}
