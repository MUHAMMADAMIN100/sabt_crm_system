import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
@Controller('analytics')
@UseInterceptors(CacheInterceptor)
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('dashboard')
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
  @CacheKey('analytics:overview')
  @CacheTTL(120000)
  getOverview() { return this.service.getDashboardOverview(); }

  @Get('projects-by-status')
  @CacheKey('analytics:projects-by-status')
  @CacheTTL(120000)
  getProjectsByStatus() { return this.service.getProjectsByStatus(); }

  @Get('tasks-by-status')
  @CacheKey('analytics:tasks-by-status')
  @CacheTTL(60000)
  getTasksByStatus() { return this.service.getTasksByStatus(); }

  @Get('tasks-by-priority')
  @CacheKey('analytics:tasks-by-priority')
  @CacheTTL(120000)
  getTasksByPriority() { return this.service.getTasksByPriority(); }

  @Get('employee-activity')
  getEmployeeActivity(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getEmployeeActivity(from, to);
  }

  @Get('hours-per-day')
  getHoursPerDay(@Query('employeeId') employeeId?: string, @Query('days') days?: string) {
    return this.service.getHoursPerDay(employeeId, days ? parseInt(days, 10) || 30 : 30);
  }

  @Get('projects-performance')
  @CacheKey('analytics:projects-performance')
  @CacheTTL(120000)
  getProjectsPerformance(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getProjectsPerformance(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10);
  }

  @Get('employee-efficiency')
  @CacheKey('analytics:employee-efficiency')
  @CacheTTL(120000)
  getEmployeeEfficiency(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getEmployeeEfficiency(parseInt(page ?? '1', 10) || 1, parseInt(limit ?? '10', 10) || 10);
  }

  @Get('employee-workload')
  @CacheKey('analytics:employee-workload')
  @CacheTTL(60000)
  getEmployeeWorkload() { return this.service.getEmployeeWorkload(); }

  @Get('monthly-report')
  getMonthlyReport(@Query('year') year: string, @Query('month') month: string) {
    const now = new Date();
    return this.service.getMonthlyReport(
      parseInt(year) || now.getFullYear(),
      parseInt(month) || now.getMonth() + 1,
    );
  }

  @Get('department-stats')
  @CacheKey('analytics:department-stats')
  @CacheTTL(300000)
  getDepartmentStats() { return this.service.getDepartmentStats(); }

  @Get('avg-completion')
  @CacheKey('analytics:avg-completion')
  @CacheTTL(300000)
  getAvgCompletionTime() { return this.service.getAvgCompletionTime(); }

  @Get('sales')
  @Roles(UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES_MANAGER)
  getSalesStats() { return this.service.getSalesStats(); }

  @Get('payroll')
  @Roles(UserRole.FOUNDER)
  // No @CacheTTL — period queries differ per request
  getPayrollStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getPayrollStats(from, to);
  }
}
