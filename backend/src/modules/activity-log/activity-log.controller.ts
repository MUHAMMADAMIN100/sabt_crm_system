import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { ActivityAction } from './activity-log.entity';

@Controller('activity-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FOUNDER)
export class ActivityLogController {
  constructor(private service: ActivityLogService) {}

  @Get()
  findAll(
    @Query('userId')  userId?: string,
    @Query('action')  action?: ActivityAction,
    @Query('entity')  entity?: string,
    @Query('from')    from?: string,
    @Query('to')      to?: string,
    @Query('limit')   limit?: string,
    @Query('offset')  offset?: string,
  ) {
    return this.service.findAll({
      userId,
      action,
      entity,
      from,
      to,
      limit:  limit  ? +limit  : 50,
      offset: offset ? +offset : 0,
    });
  }
}
