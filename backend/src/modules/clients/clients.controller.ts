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
