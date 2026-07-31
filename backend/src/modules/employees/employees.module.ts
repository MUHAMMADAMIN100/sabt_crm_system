import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './employee.entity';
import { SalaryHistory } from './salary-history.entity';
import { User } from '../users/user.entity';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BirthdayScheduler } from './birthday.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, User, SalaryHistory]), GatewayModule, NotificationsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, BirthdayScheduler],
  exports: [EmployeesService],
})
export class EmployeesModule {}
