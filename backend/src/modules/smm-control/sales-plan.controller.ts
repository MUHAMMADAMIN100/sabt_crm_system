import { Body, Controller, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SalesPlanService } from './sales-plan.service';

/** План продаж менеджеров: сумму на месяц ставит основатель («Сотрудники»),
 *  менеджер видит своё окошко в профиле. */
@ApiTags('Sales plan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class SalesPlanController {
  constructor(private service: SalesPlanService) {}

  @Get('sales-plans')
  @Roles(UserRole.FOUNDER)
  list(@Query('ym') ym?: string) {
    return this.service.list(ym);
  }

  /** { ym, amount } — пусто или 0 снимает план. */
  @Put('sales-plans/:userId')
  @Roles(UserRole.FOUNDER)
  set(@Param('userId') userId: string, @Body() body: any, @Request() req) {
    return this.service.set(userId, body, req.user);
  }

  /** { ym } — суммы прошлого месяца тем, у кого плана ещё нет. */
  @Post('sales-plans/copy')
  @Roles(UserRole.FOUNDER)
  copy(@Body() body: any, @Request() req) {
    return this.service.copyPrev(body, req.user);
  }

  @Get('me/sales-plan')
  @Roles(UserRole.SALES_MANAGER_SMM, UserRole.SALES_MANAGER_DEV)
  mine(@Request() req) {
    return this.service.mine(req.user);
  }
}
