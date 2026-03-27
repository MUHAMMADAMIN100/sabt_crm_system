import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoryLog } from './story.entity';
import { StoriesService } from './stories.service';
import { StoriesController } from './stories.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoryLog])],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
