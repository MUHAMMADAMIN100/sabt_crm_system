import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { KpiModule } from '../kpi/kpi.module';
import { WorkShiftsModule } from '../work-shifts/work-shifts.module';
import { EmployeeGoal } from './employee-goal.entity';
import { ProfileStatsService } from './profile-stats.service';
import { ProfileStatsController } from './profile-stats.controller';

/** Личный профиль сотрудника (17.10.2026): эффективность из KPI, смены из
 *  табеля, серии, уровень, достижения, цели месяца и бонус. */
@Module({
  imports: [TypeOrmModule.forFeature([EmployeeGoal, User]), KpiModule, WorkShiftsModule],
  controllers: [ProfileStatsController],
  providers: [ProfileStatsService],
  // «Компас компании» берёт отсюда цели месяца людей с цифрами
  // (goalRowsFor). Зависимость в одну сторону: этот модуль компас не импортирует.
  exports: [ProfileStatsService],
})
export class ProfileStatsModule {}
