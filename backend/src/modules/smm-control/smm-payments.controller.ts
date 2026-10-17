import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SmmPaymentsService } from './smm-payments.service';

/** «Когда клиент должен заплатить»: менеджер по продажам видит своих
 *  клиентов, владелец и админ — всех. Сроки — из «Финансов»; суммы есть
 *  только в календаре панели (решение владельца 17.10.2026). */
@ApiTags('SMM payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('smm-payments')
export class SmmPaymentsController {
  constructor(private service: SmmPaymentsService) {}

  /** Деньги в календаре «Панели» менеджера: ?from=YYYY-MM-DD&to=YYYY-MM-DD. */
  @Get('calendar')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  calendar(@Query('from') from: string, @Query('to') to: string, @Request() req) {
    return this.service.calendar(req.user, from, to);
  }

  /** Клиенты SMM из «Финансов» — для выбора в карточке проекта. */
  @Get('finance-clients')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  financeClients() {
    return this.service.financeClients();
  }

  /** Колонка «Менеджер» в «Финансы → Доход → SMM»: кто берёт деньги у клиента. */
  @Get('finance-managers')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  financeManagers(@Request() req) {
    return this.service.financeManagers(req.user);
  }

  /** Связать клиента «Финансов» с SMM-проектом CRM: { projectId | null }. */
  @Patch('finance-client/:financeProjectId/project')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  linkClient(@Param('financeProjectId') financeProjectId: string, @Body() body: any, @Request() req) {
    const id = typeof body?.projectId === 'string' && body.projectId ? body.projectId : null;
    return this.service.linkClient(financeProjectId, id, req.user);
  }

  /** Менеджер клиента разработки в «Доход → Разработка»: { userId | null }. */
  @Patch('finance-client/:financeProjectId/manager')
  @Roles(UserRole.FOUNDER)
  setClientManager(@Param('financeProjectId') financeProjectId: string, @Body() body: any, @Request() req) {
    const id = typeof body?.userId === 'string' && body.userId ? body.userId : null;
    return this.service.setClientManager(financeProjectId, id, req.user);
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
