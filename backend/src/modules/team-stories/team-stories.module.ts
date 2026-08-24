import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  TeamStory, TeamStoryMedia, TeamStoryView, TeamStoryReaction, TeamStoryComment,
} from './team-story.entity';
import { User } from '../users/user.entity';
import { TeamStoriesService } from './team-stories.service';
import { TeamStoriesController, TeamStoriesMediaController } from './team-stories.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamStory, TeamStoryMedia, TeamStoryView, TeamStoryReaction, TeamStoryComment, User,
    ]),
    GatewayModule,
  ],
  controllers: [TeamStoriesController, TeamStoriesMediaController],
  providers: [TeamStoriesService],
  exports: [TeamStoriesService],
})
export class TeamStoriesModule {}
