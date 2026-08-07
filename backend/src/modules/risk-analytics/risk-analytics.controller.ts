import {
  Controller, Get, Param, Query, Request, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CacheTTL } from '@nestjs/cache-manager';
import { RiskAnalyticsService } from './risk-analytics.service';
import { UserScopedCacheInterceptor } from '../analytics/user-scoped-cache.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { directionScopeOf } from '../../common/direction-scope';

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
// Кэш ОБЯЗАН быть персональным: руководитель направления получает урезанный
// по своей сфере ответ, и общий кэш отдавал бы его цифры другим ролям (и
// наоборот — ему чужие SMM-проекты).
@UseInterceptors(UserScopedCacheInterceptor)
export class RiskAnalyticsController {
  constructor(private service: RiskAnalyticsService) {}

  // ─── Plan-Fact ─────────────────────────────────────────────────────
  @Get('plan-fact/:projectId')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getPlanFact(@Param('projectId') projectId: string, @Request() req?) {
    return this.service.getPlanFactRich(projectId, directionScopeOf(req?.user));
  }

  // ─── Workload ──────────────────────────────────────────────────────
  @Get('workload/employees')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeWorkload(@Query('employeeId') employeeId?: string, @Request() req?) {
    return this.service.getEmployeeWorkload(employeeId, directionScopeOf(req?.user));
  }

  @Get('workload/pm')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getPmWorkload(@Query('pmId') pmId?: string, @Request() req?) {
    return this.service.getPmWorkload(pmId, directionScopeOf(req?.user));
  }

  // ─── Risk Scoring ──────────────────────────────────────────────────
  @Get('risks/projects')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getProjectRisks(@Request() req?) {
    return this.service.getProjectRisks(directionScopeOf(req?.user));
  }

  @Get('risks/projects/:id')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getProjectRiskDetail(@Param('id') id: string, @Request() req?) {
    return this.service.getProjectRiskDetail(id, directionScopeOf(req?.user));
  }

  @Get('risks/employees')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeRisks(@Request() req?) {
    return this.service.getEmployeeRisks(directionScopeOf(req?.user));
  }

  @Get('risks/employees/:id')
  @RequirePerm('risks.view')
  @CacheTTL(60000)
  getEmployeeRiskDetail(@Param('id') id: string, @Request() req?) {
    return this.service.getEmployeeRiskDetail(id, directionScopeOf(req?.user));
  }
}
