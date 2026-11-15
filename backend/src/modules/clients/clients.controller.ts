import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientLeadDirection } from './client-lead.entity';
import { LeadListQuery } from './lead-list';
import type { LeadVia } from './clients.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { UserRole } from '../users/user.entity';
import { getSalesSegmentOfUser, salesRoleOf } from '../../common/sales-segment';

/** Направление лида для МП (как enum-значение ClientLeadDirection) — по
 *  основной ИЛИ второй роли (15.11.2026): МП второй ролью без фильтра видел
 *  лиды обоих направлений. */
function leadDirectionFor(user?: { role?: string | null; secondaryRole?: string | null } | null): ClientLeadDirection | undefined {
  return getSalesSegmentOfUser(user)?.leadDirection as ClientLeadDirection | undefined;
}

/** Откуда запрос: голосовой помощник ходит в API с X-Sabt-Client
 *  (internal-api.ts) — в ленте лида событие «создан» помечаем «голосом». */
function viaOf(req: any): LeadVia {
  return String(req?.headers?.['x-sabt-client'] || '') === 'telegram-voice' ? 'voice' : 'form';
}

@ApiTags('Client Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get('stats')
  @RequirePerm('clients.view')
  getStats(@Request() req) {
    return this.service.stats(leadDirectionFor(req.user));
  }

  @Get('kpi')
  @RequirePerm('clients.view')
  getKpi(
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.kpi(req.user.id, leadDirectionFor(req.user), from, to);
  }

  /** KPI всех менеджеров продаж — для виджета на дашборде основателя.
   *  Доступно только admin/founder/co_founder, остальные получат 403. */
  @Get('kpi/all')
  @RequirePerm('clients.kpi.all')
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
  @RequirePerm('clients.view')
  async getKpiByUser(
    @Param('userId') userId: string,
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const role = req.user?.role;
    const isPrivileged = ['admin', 'founder'].includes(role);
    if (!isPrivileged && req.user?.id !== userId) {
      // Тихо вернём пустой ответ — не палим существование других МП.
      return null;
    }
    // Направление определяем по роли запрошенного юзера, не по роли актора —
    // иначе founder не увидит правильный сегмент чужого МП.
    const target = await this.service.findOwnerInfo(userId);
    if (!target) return null;
    const targetSales = salesRoleOf(target);
    const direction = targetSales === 'sales_manager_smm'
      ? 'smm' as any
      : targetSales === 'sales_manager_dev'
        ? 'development' as any
        : undefined;
    return this.service.kpi(userId, direction, from, to);
  }

  /** Список лидов с серверной пагинацией (15.11.2026, SALES_SPEC §4):
   *  search, status (через запятую), interest, sphere, source,
   *  owner = me | all | none | uuid, due = overdue | today | none, hold = 1 | 0,
   *  page, pageSize (10..100), sort = next | updated | created | potential.
   *  ВАЖНО: объявлен до @Get(':id'), иначе «list» ушёл бы в findOne как id. */
  @Get('list')
  @RequirePerm('clients.view')
  list(@Request() req, @Query() query: LeadListQuery) {
    return this.service.list(query || {}, req.user, leadDirectionFor(req.user));
  }

  /** Доска «Воронка»: все активные лиды + выигранные/проигранные за 30 дней.
   *  Параметры owner, search. Тоже до @Get(':id'). */
  @Get('board')
  @RequirePerm('clients.view')
  board(@Request() req, @Query('owner') owner?: string, @Query('search') search?: string) {
    return this.service.board({ owner, search }, req.user, leadDirectionFor(req.user));
  }

  /** Массив до 500 лидов — голосовой помощник и старые экраны. */
  @Get()
  @RequirePerm('clients.view')
  findAll(
    @Request() req,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('interest') interest?: string,
    @Query('sphere') sphere?: string,
    @Query('ownerId') ownerId?: string,
    @Query('source') source?: string,
  ) {
    return this.service.findAll({
      search, status, interest, sphere, ownerId, source,
      direction: leadDirectionFor(req.user),
    });
  }

  @Get(':id')
  @RequirePerm('clients.view')
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, leadDirectionFor(req.user));
  }

  @Post()
  @RequirePerm('clients.create')
  create(@Body() dto: CreateClientDto, @Request() req) {
    // Направление лида задаётся автоматически по сегменту менеджера-создателя.
    // Владелец — по правилам (createWithAuth): МП — себе или МП своего
    // направления; руководство — кого укажет. force — создать, несмотря на
    // похожие лиды (иначе 409 { message: 'duplicate', duplicates }).
    const direction = leadDirectionFor(req.user);
    return this.service.createWithAuth(
      { ...(dto as any), direction: direction ?? dto.direction },
      req.user,
      { via: viaOf(req) },
    );
  }

  /** «Взять себе» лид без владельца своего направления (15.11.2026). */
  @Post(':id/claim')
  @RequirePerm('clients.edit')
  claim(@Param('id') id: string, @Request() req) {
    return this.service.claim(id, req.user);
  }

  /** «Позвонить»: руководитель отмечает лидов для обзвона менеджером
   *  (flag=true), снимает отметку — руководитель или владелец (flag=false). */
  @Post('call-request')
  @RequirePerm('clients.edit')
  callRequest(@Body() body: { ids: string[]; flag: boolean }, @Request() req) {
    return this.service.setCallRequest(body?.ids || [], !!body?.flag, req.user);
  }

  @Patch(':id')
  @RequirePerm('clients.edit')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @Request() req) {
    // Направление лида менять через update нельзя — оно фиксируется при создании.
    const { direction: _ignored, ...rest } = dto || {};
    return this.service.updateWithAuth(id, rest as any, req.user);
  }

  @Delete(':id')
  @RequirePerm('clients.delete')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.removeWithAuth(id, req.user);
  }
}
