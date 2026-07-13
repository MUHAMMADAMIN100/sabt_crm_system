import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrgClient, OrgModel, OrgPlace } from './organizer-directory.entity';
import { OrganizerDirectoryService } from './organizer-directory.service';
import { OrganizerDirectoryController } from './organizer-directory.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrgClient, OrgModel, OrgPlace])],
  controllers: [OrganizerDirectoryController],
  providers: [OrganizerDirectoryService],
})
export class OrganizerDirectoryModule {}
