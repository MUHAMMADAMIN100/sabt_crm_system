import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectAd } from './project-ad.entity';
import { ProjectAdsService } from './project-ads.service';
import { ProjectAdsController } from './project-ads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectAd])],
  controllers: [ProjectAdsController],
  providers: [ProjectAdsService],
  exports: [ProjectAdsService],
})
export class ProjectAdsModule {}
