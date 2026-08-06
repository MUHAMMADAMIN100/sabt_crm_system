import {
  Controller, Get, Param, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RiskAnalyticsService } from './risk-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

const VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.FOUNDER,
  UserRole.CO_FOUNDER,
  UserRole.SMM_DIRECTOR,
  UserRole.VIDEO_DIRECTOR,
  UserRole.DEV_DIRECTOR,
];

@ApiTags('Risk Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(...VIEW_ROLES)
@Controller('risk-analytics')
@UseInterceptors(CacheInterceptor)
export class RiskAnalyticsController {
  constructor(private service: RiskAnalyticsService) {}

  // ─── Plan-Fact ─────────────────────────────────────────────────────
  @Get('plan-fact/:projectId')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getPlanFact(@Param('projectId') projectId: string) {
    return this.service.getPlanFactRich(projectId);
  }

  // ─── Workload ──────────────────────────────────────────────────────
  @Get('workload/employees')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeWorkload(@Query('employeeId') employeeId?: string) {
    return this.service.getEmployeeWorkload(employeeId);
  }

  @Get('workload/pm')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getPmWorkload(@Query('pmId') pmId?: string) {
    return this.service.getPmWorkload(pmId);
  }

  // ─── Risk Scoring ──────────────────────────────────────────────────
  @Get('risks/projects')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getProjectRisks() {
    return this.service.getProjectRisks();
  }

  @Get('risks/projects/:id')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getProjectRiskDetail(@Param('id') id: string) {
    return this.service.getProjectRiskDetail(id);
  }

  @Get('risks/employees')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeRisks() {
    return this.service.getEmployeeRisks();
  }

  @Get('risks/employees/:id')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeRiskDetail(@Param('id') id: string) {
    return this.service.getEmployeeRiskDetail(id);
  }
}
