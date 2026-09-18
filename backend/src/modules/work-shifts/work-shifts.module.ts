import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkShift } from './work-shift.entity';
import { User } from '../users/user.entity';
import { WorkShiftsService } from './work-shifts.service';
import { WorkShiftsController } from './work-shifts.controller';

/** Рабочие смены. Зависимостей на другие модули нет намеренно: рассылки и
 *  уведомления сюда не тянем, чтобы не плодить кольца (см. историю с
 *  ContentPlan → Telegram → Tasks → Projects). */
@Module({
  imports: [TypeOrmModule.forFeature([WorkShift, User])],
  controllers: [WorkShiftsController],
  providers: [WorkShiftsService],
})
export class WorkShiftsModule {}
