import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
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
  getKpi(@Request() req) {
    return this.service.kpi(req.user.id, leadDirectionFor(req.user?.role));
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
  create(@Body() dto: any, @Request() req) {
    // Направление лида задаётся автоматически по сегменту менеджера-создателя.
    // meetingTaskId выставляется только сервером — игнорируем то, что прислал фронт.
    const direction = leadDirectionFor(req.user?.role);
    const { meetingTaskId: _t, ...rest } = dto || {};
    return this.service.create({ ...rest, direction: direction ?? rest.direction }, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    // Направление лида менять через update нельзя — оно фиксируется при создании.
    // meetingTaskId — внутреннее поле, выставляется сервером.
    const { direction: _ignored, meetingTaskId: _t, ...rest } = dto || {};
    return this.service.update(id, rest);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
