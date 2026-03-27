import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeLog } from './time-log.entity';
import { TimeTrackerService } from './time-tracker.service';
import { TimeTrackerController } from './time-tracker.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TimeLog])],
  controllers: [TimeTrackerController],
  providers: [TimeTrackerService],
  exports: [TimeTrackerService],
})
export class TimeTrackerModule {}
