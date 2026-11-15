import { Controller, ForbiddenException, Get, Query, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { AnalyticsService } from './analytics.service';
import { UserScopedCacheInterceptor, SkipCache } from './user-scoped-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { DirectionScope, directionScopeOf, TOP_ROLES } from '../../common/direction-scope';
import { salesRoleOf } from '../../common/sales-segment';

/** Роли со сводной аналитикой всей компании (основная или вторая роль). */
const COMPANY_ANALYTICS_ROLES = [...TOP_ROLES, 'smm_director'];

type Viewer = { id?: string; role?: string | null; secondaryRole?: string | null } | null | undefined;

const hasAnyRole = (user: Viewer, roles: string[]) =>
  !!user && (roles.includes(user.role || '') || roles.includes(user.secondaryRole || ''));

/**
 * Скоуп сводной аналитики (15.11.2026):
 *  · руководитель/PM разработки — только своё направление (как и раньше);
 *  · руководство (admin/founder/smm_director) — вся компания;
 *  · менеджер продаж (роль ИЛИ вторая роль) — 403: сводки компании ему не
 *    положены, его цифры — в /analytics/sales по сегменту. Раньше МП видел
 *    проекты, задачи, загрузку и часы всей компании;
 *  · прочие, кому analytics.view выдан грантом, — вся компания, как раньше.
 */
function analyticsScopeOf(user: Viewer): DirectionScope | null {
  const scope = directionScopeOf(user);
  if (scope) return scope;
  if (hasAnyRole(user, COMPANY_ANALYTICS_ROLES)) return null;
  if (salesRoleOf(user)) {
    throw new ForbiddenException('Сводная аналитика компании менеджеру продаж недоступна');
  }
  return null;
}

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
@Controller('analytics')
@UseInterceptors(UserScopedCacheInterceptor)
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('dashboard')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:dashboard')
  @CacheTTL(120000)
  async getDashboard(@Request() req?) {
    // Руководитель направления видит сводку только своей сферы: цифры,
    // графики и команда считаются по его проектам и его людям.
    const scope = analyticsScopeOf(req?.user);
    const [overview, projByStatus, taskByStatus, taskByPriority, empActivity, hoursPerDay, projPerfPaged, empEffPaged] = await Promise.all([
      this.service.getDashboardOverview(scope),
      this.service.getProjectsByStatus(scope),
      this.service.getTasksByStatus(scope),
      this.service.getTasksByPriority(scope),
      this.service.getEmployeeActivity(undefined, undefined, scope),
      // Часы — тоже по скоупу направления (15.11.2026), раньше вся компания.
      this.service.getHoursPerDay(undefined, 30, scope),
      this.service.getProjectsPerformance(1, 9, scope),
      this.service.getEmployeeEfficiency(1, 9, scope),
    ]);
    // Dashboard uses flat arrays; paginated endpoints return {data,...}
    return {
      overview, projByStatus, taskByStatus, taskByPriority, empActivity, hoursPerDay,
      projPerf: projPerfPaged.data,
      empEff: empEffPaged.data,
    };
  }

  @Get('overview')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:overview')
  @CacheTTL(120000)
  getOverview(@Request() req?) { return this.service.getDashboardOverview(analyticsScopeOf(req?.user)); }

  @Get('projects-by-status')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:projects-by-status')
  @CacheTTL(120000)
  getProjectsByStatus(@Request() req?) { return this.service.getProjectsByStatus(analyticsScopeOf(req?.user)); }

  @Get('tasks-by-status')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:tasks-by-status')
  @CacheTTL(60000)
  getTasksByStatus(@Request() req?) { return this.service.getTasksByStatus(analyticsScopeOf(req?.user)); }

  @Get('tasks-by-priority')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:tasks-by-priority')
  @CacheTTL(120000)
  getTasksByPriority(@Request() req?) { return this.service.getTasksByPriority(analyticsScopeOf(req?.user)); }

  @Get('employee-activity')
  @RequirePerm('analytics.view')
  getEmployeeActivity(@Query('from') from?: string, @Query('to') to?: string, @Request() req?) {
    return this.service.getEmployeeActivity(from, to, analyticsScopeOf(req?.user));
  }

  @Get('hours-per-day')
  @RequirePerm('analytics.view')
  getHoursPerDay(@Query('employeeId') employeeId?: string, @Query('days') days?: string, @Request() req?) {
    const d = days ? parseInt(days, 10) || 30 : 30;
    const user = req?.user;
    // (15.11.2026) Раньше часы любого сотрудника по ?employeeId= получал
    // любой с analytics.view. Теперь: МП (роль или вторая роль) без
    // руководящей роли — только свои часы; руководитель направления — только
    // своя команда (фильтр в запросе); руководство — кто угодно.
    if (salesRoleOf(user) && !directionScopeOf(user) && !hasAnyRole(user, COMPANY_ANALYTICS_ROLES)) {
      if (employeeId && employeeId !== user?.id) {
        throw new ForbiddenException('Можно смотреть только свои часы');
      }
      return this.service.getHoursPerDay(user?.id, d);
    }
    return this.service.getHoursPerDay(employeeId || undefined, d, analyticsScopeOf(user));
  }

  @Get('projects-performance')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:projects-performance')
  @CacheTTL(120000)
  getProjectsPerformance(@Query('page') page?: string, @Query('limit') limit?: string, @Request() req?) {
    return this.service.getProjectsPerformance(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10, analyticsScopeOf(req?.user));
  }

  @Get('employee-efficiency')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:employee-efficiency')
  @CacheTTL(120000)
  getEmployeeEfficiency(@Query('page') page?: string, @Query('limit') limit?: string, @Request() req?) {
    return this.service.getEmployeeEfficiency(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10, analyticsScopeOf(req?.user));
  }

  @Get('employee-workload')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:employee-workload')
  @CacheTTL(60000)
  getEmployeeWorkload(@Request() req?) { return this.service.getEmployeeWorkload(analyticsScopeOf(req?.user)); }

  @Get('monthly-report')
  @RequirePerm('analytics.view')
  getMonthlyReport(@Query('year') year: string, @Query('month') month: string, @Request() req?) {
    // Сводка компании: МП — 403 (15.11.2026). Скоупа направления у отчёта нет.
    analyticsScopeOf(req?.user);
    const now = new Date();
    return this.service.getMonthlyReport(
      parseInt(year) || now.getFullYear(),
      parseInt(month) || now.getMonth() + 1,
    );
  }

  @Get('department-stats')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:department-stats')
  @CacheTTL(300000)
  getDepartmentStats(@Request() req?) {
    analyticsScopeOf(req?.user); // МП — 403 (15.11.2026)
    return this.service.getDepartmentStats();
  }

  @Get('avg-completion')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:avg-completion')
  @CacheTTL(300000)
  getAvgCompletionTime(@Request() req?) {
    analyticsScopeOf(req?.user); // МП — 403 (15.11.2026)
    return this.service.getAvgCompletionTime();
  }

  @Get('sales')
  @RequirePerm('analytics.sales')
  // Персональные данные (направление + личный архив менеджера) + мутируют при
  // скрытии проекта — не кэшируем, иначе скрытие видно не сразу.
  @SkipCache()
  getSalesStats(@Request() req) {
    const user = req.user;
    // Сегмент МП — по основной ИЛИ второй роли (15.11.2026): раньше МП второй
    // ролью видел продажи обоих направлений. Админ/основатель — всё.
    const role = hasAnyRole(user, TOP_ROLES) ? user?.role : (salesRoleOf(user) ?? user?.role);
    return this.service.getSalesStats(role, user?.id);
  }

  @Get('payroll')
  @RequirePerm('analytics.payroll')
  // No @CacheTTL — period queries differ per request
  getPayrollStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getPayrollStats(from, to);
  }

  @Get('income-expense')
  @RequirePerm('analytics.income-expense')
  getIncomeExpense(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.getIncomeExpense(from, to, projectId);
  }

  @Get('stories-global')
  // smm_director — руководитель SMM, должен видеть истории всей SMM-команды
  // (без него глобальный календарь у него на дашборде не загружается).
  @Roles(UserRole.FOUNDER, UserRole.ADMIN, UserRole.SMM_DIRECTOR)
  getStoriesGlobal(
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getStoriesGlobal(from, to);
  }

  @Get('report/projects')
  @RequirePerm('analytics.export')
  getProjectReport(
    @Query('period') period: 'week' | 'month' = 'week',
    @Query('projectId') projectId?: string,
  ) {
    return this.service.getProjectReport(period, projectId || undefined);
  }

  @Get('report/employees')
  @RequirePerm('analytics.export')
  getEmployeeReport(
    @Query('period') period: 'week' | 'month' = 'week',
    @Query('employeeId') employeeId?: string,
  ) {
    return this.service.getEmployeeReport(period, employeeId || undefined);
  }
}
