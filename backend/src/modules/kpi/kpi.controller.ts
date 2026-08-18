import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { SmmDailyService } from './smm-daily.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { directionScopeOf } from '../../common/direction-scope';

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kpi')
export class KpiController {
  constructor(
    private kpi: KpiService,
    private smmDaily: SmmDailyService,
  ) {}

  /** KPI сотрудников за период. Руководство видит всех; руководитель
   *  направления (в т.ч. второй ролью) — только свою команду: сервис
   *  урезает выборку по скоупу, роль сама по себе всех не открывает. */
  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.DEV_DIRECTOR)
  getAll(@Query('from') from?: string, @Query('to') to?: string, @Request() req?) {
    return this.kpi.getAllKpi(from, to, directionScopeOf(req?.user));
  }

  /** Ежедневный автоотчёт: что каждый сделал за день. Видит ТОЛЬКО
   *  основатель. По умолчанию — вся компания, как в вечернем отчёте в
   *  Telegram: страница по ссылке из отчёта должна показывать то же
   *  самое. scope=smm оставляет прежний срез по СММ-отделу. */
  @Get('smm-daily')
  @Roles(UserRole.FOUNDER)
  getSmmDaily(@Query('date') date?: string, @Query('scope') scope?: string) {
    return this.smmDaily.getDaily(date, { allStaff: scope !== 'smm' });
  }

  /** Может ли смотрящий видеть KPI этого сотрудника: руководство — любого,
   *  руководитель направления — своей команды, остальные — только свой. */
  private async canSeeKpiOf(req: any, userId: string): Promise<boolean> {
    const role = req?.user?.role;
    if (['admin', 'founder', 'co_founder'].includes(role)) return true;
    if (req?.user?.id === userId) return true;
    const scope = directionScopeOf(req?.user);
    if (!scope) return false;
    return this.kpi.isUserInDirection(userId, scope);
  }

  /** KPI конкретного юзера.
   *   - admin/founder/co_founder — любого;
   *   - руководитель направления — своей команды;
   *   - сам юзер — только свой. */
  @Get('user/:userId')
  async getOne(
    @Param('userId') userId: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!(await this.canSeeKpiOf(req, userId))) return null;
    return this.kpi.getUserKpi(userId, from, to);
  }

  /** Детализация конкретной KPI-метрики — список записей за период.
   *  Для модалки «открыть подробно» при клике на карточку метрики. */
  @Get('user/:userId/details')
  async getDetails(
    @Param('userId') userId: string,
    @Query('metric') metric: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!(await this.canSeeKpiOf(req, userId))) return [];
    if (!metric) return [];
    return this.kpi.getMetricDetails(userId, metric, from, to);
  }
}
