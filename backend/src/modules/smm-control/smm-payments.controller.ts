import { Body, Controller, Get, Param, Patch, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SmmPaymentsService } from './smm-payments.service';

/** «Когда клиент должен заплатить» по SMM-проектам: менеджер по продажам
 *  видит свои проекты, владелец и админ — все. Сроки — из «Финансов», сумм
 *  в ответах нет. */
@ApiTags('SMM payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('smm-payments')
export class SmmPaymentsController {
  constructor(private service: SmmPaymentsService) {}

  /** Блок «Оплаты клиентов» на панели менеджера. */
  @Get('mine')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  mine(@Request() req) {
    return this.service.mine(req.user);
  }

  /** Клиенты SMM из «Финансов» — для выбора в карточке проекта. */
  @Get('finance-clients')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  financeClients() {
    return this.service.financeClients();
  }

  /** Строка «Оплата клиента» в карточке SMM-проекта. */
  @Get('project/:projectId')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  project(@Param('projectId') projectId: string, @Request() req) {
    return this.service.project(projectId, req.user);
  }

  /** Связать проект с клиентом «Финансов»: { financeProjectId | null }. */
  @Patch('project/:projectId/link')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  link(@Param('projectId') projectId: string, @Body() body: any, @Request() req) {
    const id = typeof body?.financeProjectId === 'string' && body.financeProjectId ? body.financeProjectId : null;
    return this.service.link(projectId, id, req.user);
  }
}
