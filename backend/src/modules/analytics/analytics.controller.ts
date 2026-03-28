import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(private service: AnalyticsService) {}

  @Get('dashboard')
  async getDashboard() {
    const [overview, projByStatus, taskByStatus, taskByPriority, empActivity, hoursPerDay, projPerf, empEff] = await Promise.all([
      this.service.getDashboardOverview(),
      this.service.getProjectsByStatus(),
      this.service.getTasksByStatus(),
      this.service.getTasksByPriority(),
      this.service.getEmployeeActivity(),
      this.service.getHoursPerDay(undefined, 30),
      this.service.getProjectsPerformance(),
      this.service.getEmployeeEfficiency(),
    ]);
    return { overview, projByStatus, taskByStatus, taskByPriority, empActivity, hoursPerDay, projPerf, empEff };
  }

  @Get('overview')
  getOverview() { return this.service.getDashboardOverview(); }

  @Get('projects-by-status')
  getProjectsByStatus() { return this.service.getProjectsByStatus(); }

  @Get('tasks-by-status')
  getTasksByStatus() { return this.service.getTasksByStatus(); }

  @Get('tasks-by-priority')
  getTasksByPriority() { return this.service.getTasksByPriority(); }

  @Get('employee-activity')
  getEmployeeActivity(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getEmployeeActivity(from, to);
  }

  @Get('hours-per-day')
  getHoursPerDay(@Query('employeeId') employeeId?: string, @Query('days') days?: string) {
    return this.service.getHoursPerDay(employeeId, days ? parseInt(days) : 30);
  }

  @Get('projects-performance')
  getProjectsPerformance() { return this.service.getProjectsPerformance(); }

  @Get('employee-efficiency')
  getEmployeeEfficiency() { return this.service.getEmployeeEfficiency(); }

  @Get('monthly-report')
  getMonthlyReport(@Query('year') year: string, @Query('month') month: string) {
    const now = new Date();
    return this.service.getMonthlyReport(
      parseInt(year) || now.getFullYear(),
      parseInt(month) || now.getMonth() + 1,
    );
  }

  @Get('department-stats')
  getDepartmentStats() { return this.service.getDepartmentStats(); }
}
