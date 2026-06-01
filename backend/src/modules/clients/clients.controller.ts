import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientLeadStatus, ClientLeadInterest, ClientLeadDirection } from './client-lead.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { getSalesSegment } from '../../common/sales-segment';

/** Направление лида для роли МП (как enum-значение ClientLeadDirection). */
function leadDirectionFor(role?: string): ClientLeadDirection | undefined {
  return getSalesSegment(role)?.leadDirection as ClientLeadDirection | undefined;
}

@ApiTags('Client Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get('stats')
  getStats(@Request() req) {
    return this.service.stats(leadDirectionFor(req.user?.role));
  }

  @Get('kpi')
  getKpi(
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.kpi(req.user.id, leadDirectionFor(req.user?.role), from, to);
  }

  /** KPI всех менеджеров продаж — для виджета на дашборде основателя.
   *  Доступно только admin/founder/co_founder, остальные получат 403. */
  @Get('kpi/all')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  getKpiAll(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.kpiForAllSalesManagers(from, to);
  }

  /** KPI конкретного сотрудника-МП по userId. Доступ:
   *   - admin/founder/co_founder — любого МП;
   *   - сам менеджер — только свой userId. */
  @Get('kpi/user/:userId')
  async getKpiByUser(
    @Param('userId') userId: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const role = req.user?.role;
    const isPrivileged = ['admin', 'founder', 'co_founder'].includes(role);
    if (!isPrivileged && req.user?.id !== userId) {
      // Тихо вернём пустой ответ — не палим существование других МП.
      return null;
    }
    // Направление определяем по роли запрошенного юзера, не по роли актора —
    // иначе founder не увидит правильный сегмент чужого МП.
    const target = await this.service.findOwnerInfo(userId);
    if (!target) return null;
    const direction = target.role === 'sales_manager_smm'
      ? 'smm' as any
      : target.role === 'sales_manager_dev'
        ? 'development' as any
        : undefined;
    return this.service.kpi(userId, direction, from, to);
  }

  @Get()
  findAll(
    @Request() req,
    @Query('search') search?: string,
    @Query('status') status?: ClientLeadStatus,
    @Query('interest') interest?: ClientLeadInterest,
    @Query('sphere') sphere?: string,
    @Query('ownerId') ownerId?: string,
    @Query('source') source?: string,
  ) {
    return this.service.findAll({
      search, status, interest, sphere, ownerId, source,
      direction: leadDirectionFor(req.user?.role),
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, leadDirectionFor(req.user?.role));
  }

  @Post()
  create(@Body() dto: CreateClientDto, @Request() req) {
    // Направление лида задаётся автоматически по сегменту менеджера-создателя.
    // meetingTaskId выставляется только сервером — игнорируем то, что прислал фронт.
    const direction = leadDirectionFor(req.user?.role);
    return this.service.create(
      { ...(dto as any), direction: direction ?? dto.direction },
      req.user.id,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @Request() req) {
    // Направление лида менять через update нельзя — оно фиксируется при создании.
    const { direction: _ignored, ...rest } = dto || {};
    return this.service.updateWithAuth(id, rest as any, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.removeWithAuth(id, req.user);
  }
}
