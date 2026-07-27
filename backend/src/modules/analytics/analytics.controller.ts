import { Controller, Get, Query, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { AnalyticsService } from './analytics.service';
import { UserScopedCacheInterceptor, SkipCache } from './user-scoped-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.VIDEO_DIRECTOR, UserRole.SMM_DIRECTOR, UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
@Controller('analytics')
@UseInterceptors(UserScopedCacheInterceptor)
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('dashboard')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:dashboard')
  @CacheTTL(120000)
  async getDashboard() {
    const [overview, projByStatus, taskByStatus, taskByPriority, empActivity, hoursPerDay, projPerfPaged, empEffPaged] = await Promise.all([
      this.service.getDashboardOverview(),
      this.service.getProjectsByStatus(),
      this.service.getTasksByStatus(),
      this.service.getTasksByPriority(),
      this.service.getEmployeeActivity(),
      this.service.getHoursPerDay(undefined, 30),
      this.service.getProjectsPerformance(1, 9),
      this.service.getEmployeeEfficiency(1, 9),
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
  getOverview() { return this.service.getDashboardOverview(); }

  @Get('projects-by-status')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:projects-by-status')
  @CacheTTL(120000)
  getProjectsByStatus() { return this.service.getProjectsByStatus(); }

  @Get('tasks-by-status')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:tasks-by-status')
  @CacheTTL(60000)
  getTasksByStatus() { return this.service.getTasksByStatus(); }

  @Get('tasks-by-priority')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:tasks-by-priority')
  @CacheTTL(120000)
  getTasksByPriority() { return this.service.getTasksByPriority(); }

  @Get('employee-activity')
  @RequirePerm('analytics.view')
  getEmployeeActivity(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getEmployeeActivity(from, to);
  }

  @Get('hours-per-day')
  @RequirePerm('analytics.view')
  getHoursPerDay(@Query('employeeId') employeeId?: string, @Query('days') days?: string) {
    return this.service.getHoursPerDay(employeeId, days ? parseInt(days, 10) || 30 : 30);
  }

  @Get('projects-performance')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:projects-performance')
  @CacheTTL(120000)
  getProjectsPerformance(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getProjectsPerformance(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10);
  }

  @Get('employee-efficiency')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:employee-efficiency')
  @CacheTTL(120000)
  getEmployeeEfficiency(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getEmployeeEfficiency(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10);
  }

  @Get('employee-workload')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:employee-workload')
  @CacheTTL(60000)
  getEmployeeWorkload() { return this.service.getEmployeeWorkload(); }

  @Get('monthly-report')
  @RequirePerm('analytics.view')
  getMonthlyReport(@Query('year') year: string, @Query('month') month: string) {
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
  getDepartmentStats() { return this.service.getDepartmentStats(); }

  @Get('avg-completion')
  @RequirePerm('analytics.view')
  @CacheKey('analytics:avg-completion')
  @CacheTTL(300000)
  getAvgCompletionTime() { return this.service.getAvgCompletionTime(); }

  @Get('sales')
  @RequirePerm('analytics.sales')
  // Персональные данные (направление + личный архив менеджера) + мутируют при
  // скрытии проекта — не кэшируем, иначе скрытие видно не сразу.
  @SkipCache()
  getSalesStats(@Request() req) { return this.service.getSalesStats(req.user?.role, req.user?.id); }

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
  @Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.ADMIN, UserRole.SMM_DIRECTOR)
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
