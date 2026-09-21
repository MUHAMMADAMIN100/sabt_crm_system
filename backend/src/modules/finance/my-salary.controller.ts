import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
  constructor(private service: FinanceService) {}

  /** Зарплата за месяц (по умолчанию текущий) + история закрытых месяцев. */
  @Get('salary')
  mySalary(@Request() req: any, @Query('ym') ym?: string) {
    return this.service.mySalary(req.user.id, ym);
  }
}
