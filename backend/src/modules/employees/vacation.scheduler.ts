import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee, EmployeeStatus } from './employee.entity';
import { AppGateway } from '../gateway/app.gateway';
import { dushanbeToday } from './vacation';

/** Отпуск кончился — статус сам возвращается в «Активный» (27.10.2026).
 *  Доступ открывается уже по датам (vacationNow), крон лишь наводит порядок
 *  в статусе, чтобы в списке сотрудников не висело «В отпуске». */
@Injectable()
export class VacationScheduler {
  private readonly logger = new Logger(VacationScheduler.name);

  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    private gateway: AppGateway,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'Asia/Dushanbe' })
  async endFinishedVacations() {
    try {
      const rows = await this.repo.createQueryBuilder('e')
        .where('e.status = :status', { status: EmployeeStatus.VACATION })
        .andWhere('e."vacationUntil" < :today', { today: dushanbeToday() })
        .getMany();
      for (const e of rows) {
        e.status = EmployeeStatus.ACTIVE;
        e.vacationFrom = null;
        e.vacationUntil = null;
        await this.repo.save(e);
        if (e.userId) this.gateway.notifyUser(e.userId, 'me:changed', {});
      }
      if (rows.length) {
        this.gateway.broadcast('employees:changed', {});
        this.logger.log(`vacation ended: ${rows.length}`);
      }
    } catch (e: any) {
      this.logger.warn(`vacation end failed: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
}
