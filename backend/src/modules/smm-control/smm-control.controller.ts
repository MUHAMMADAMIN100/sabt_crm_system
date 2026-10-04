import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SmmControlService } from './smm-control.service';

/** Раздел «СММ → Контроль»: доволен ли клиент, свежий ли аккаунт,
 *  сделано ли обязательное — по каждому SMM-проекту за месяц. */
@ApiTags('SMM control')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('smm-control')
export class SmmControlController {
  constructor(private service: SmmControlService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST)
  list(@Query('ym') ym: string, @Request() req) {
    return this.service.list(ym, req.user);
  }

  /** Отметка: { ym, mood?, moodNote?, contact?, report? }. */
  @Patch(':projectId')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.SMM_DIRECTOR, UserRole.SMM_SPECIALIST)
  update(@Param('projectId') projectId: string, @Body() body: any, @Request() req) {
    return this.service.update(projectId, body || {}, req.user);
  }
}
