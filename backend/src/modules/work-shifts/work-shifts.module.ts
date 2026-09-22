import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkShift } from './work-shift.entity';
import { ShiftEditRequest } from './shift-edit-request.entity';
import { ShiftAbsence } from './shift-absence.entity';
import { WorkSchedule } from './work-schedule.entity';
import { LateNotice } from './late-notice.entity';
import { ShiftSettings } from './shift-settings.entity';
import { User } from '../users/user.entity';
import { WorkShiftsService } from './work-shifts.service';
import { WorkShiftsController } from './work-shifts.controller';

/** Рабочие смены. Своих импортов модулей по-прежнему нет: напоминания шлём
 *  через TelegramService, а он доступен как @Global — нового ребра в графе
 *  зависимостей не появляется и кольца (ContentPlan → Telegram → Tasks →
 *  Projects) не повторяются. */
@Module({
  imports: [TypeOrmModule.forFeature([WorkShift, ShiftEditRequest, ShiftAbsence, WorkSchedule, LateNotice, ShiftSettings, User])],
  controllers: [WorkShiftsController],
  providers: [WorkShiftsService],
})
export class WorkShiftsModule {}
