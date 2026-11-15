import { Controller, ForbiddenException, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { hasGrant } from '../auth/permissions';
import { User } from '../users/user.entity';

/** «Моя зарплата» в личном профиле.
 *
 *  Отдельный контроллер, а не метод в FinanceController: тот целиком закрыт
 *  FinanceAccessGuard (право finance.manage — только владелец и сооснователь).
 *  Здесь доступ есть у любого авторизованного, поэтому сервис отдаёт СТРОГО
 *  строку самого запрашивающего — id сотрудника снаружи не принимается. */
@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MySalaryController {
  constructor(
    private service: FinanceService,
    // User уже зарегистрирован в TypeOrmModule.forFeature модуля финансов.
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /** Зарплата за месяц (по умолчанию текущий) + история закрытых месяцев. */
  @Get('salary')
  async mySalary(@Request() req: any, @Query('ym') ym?: string) {
    // «Войти как» (15.11.2026): чужую зарплату видит только тот, у кого
    // есть право на зарплаты сотрудников, — права входящего берём из базы.
    const actorId = req.user?.impersonatorId;
    if (actorId) {
      const actor = await this.userRepo.findOne({ where: { id: actorId } });
      if (!hasGrant(actor, 'employees.salary.view')) {
        throw new ForbiddenException('Зарплата сотрудника недоступна при входе от его имени');
      }
    }
    return this.service.mySalary(req.user.id, ym);
  }
}
