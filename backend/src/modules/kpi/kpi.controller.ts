import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kpi')
export class KpiController {
  constructor(private kpi: KpiService) {}

  /** KPI всех сотрудников за период. Для дашборда основателя. */
  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  getAll(@Query('from') from?: string, @Query('to') to?: string) {
    return this.kpi.getAllKpi(from, to);
  }

  /** KPI конкретного юзера.
   *   - admin/founder/co_founder — любого;
   *   - сам юзер — только свой. */
  @Get('user/:userId')
  async getOne(
    @Param('userId') userId: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const role = req.user?.role;
    const isPrivileged = ['admin', 'founder', 'co_founder'].includes(role);
    if (!isPrivileged && req.user?.id !== userId) {
      return null;
    }
    return this.kpi.getUserKpi(userId, from, to);
  }
}
