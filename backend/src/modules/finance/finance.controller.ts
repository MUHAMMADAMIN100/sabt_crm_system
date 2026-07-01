import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { CreateFinanceTransactionDto } from './dto/create-finance-transaction.dto';
import { UpdateFinanceTransactionDto } from './dto/update-finance-transaction.dto';
import {
  FinanceAccount, FinanceTxStatus, FinanceTxType,
} from './finance-transaction.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

/** Финансовый модуль доступен только основателю и сооснователю. */
@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER)
@Controller('finance')
export class FinanceController {
  constructor(private service: FinanceService) {}

  // ─── Aggregators ─────────────────────────────────────────────────
  @Get('accounts-summary')
  getAccountsSummary() { return this.service.getAccountsSummary(); }

  @Get('monthly')
  getMonthly(
    @Query('account') account?: FinanceAccount,
    @Query('months') months?: string,
  ) {
    return this.service.getMonthly(account, months ? parseInt(months, 10) || 6 : 6);
  }

  @Get('by-category')
  getByCategory(
    @Query('account') account?: FinanceAccount,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getByCategory(account, from, to);
  }

  /** Список категорий для выпадашки в форме (стандартные + пользовательские). */
  @Get('categories')
  getCategories() { return this.service.getCategories(); }

  // ─── Стартовые балансы счетов ─────────────────────────────────────
  @Get('opening-balances')
  getOpening() { return this.service.getOpeningBalances(); }
  @Patch('opening-balances')
  setOpening(@Body() body: any) { return this.service.setOpeningBalances(body || {}); }

  // ─── Подписки / аренда ────────────────────────────────────────────
  @Get('subscriptions')
  listSubs() { return this.service.listSubscriptions(); }
  @Get('subscriptions/month')
  subsMonth(@Query('ym') ym: string) { return this.service.subscriptionsForMonth(ym); }
  @Post('subscriptions')
  createSub(@Body() body: any) { return this.service.createSubscription(body); }
  @Patch('subscriptions/:id')
  updateSub(@Param('id') id: string, @Body() body: any) { return this.service.updateSubscription(id, body); }
  @Delete('subscriptions/:id')
  deleteSub(@Param('id') id: string) { return this.service.deleteSubscription(id); }
  @Post('subscriptions/:id/pay')
  paySub(@Param('id') id: string, @Body() body: any) { return this.service.paySubscription(id, body?.ym, body?.account, body?.date); }
  @Delete('subscriptions/:id/pay')
  cancelSub(@Param('id') id: string, @Query('ym') ym: string) { return this.service.cancelSubscriptionMonth(id, ym); }

  // ─── Долги ────────────────────────────────────────────────────────
  @Get('debts')
  listDebts() { return this.service.listDebts(); }
  @Get('debts/matrix')
  debtsMatrix(@Query('start') start?: string, @Query('months') months?: string) {
    return this.service.debtsMatrix(start, months ? parseInt(months, 10) || 6 : 6);
  }
  @Post('debts')
  createDebt(@Body() body: any) { return this.service.createDebt(body); }
  @Patch('debts/:id')
  updateDebt(@Param('id') id: string, @Body() body: any) { return this.service.updateDebt(id, body); }
  @Delete('debts/:id')
  deleteDebt(@Param('id') id: string) { return this.service.deleteDebt(id); }
  @Post('debts/:id/regenerate')
  regenDebt(@Param('id') id: string) { return this.service.regenerateDebtSchedule(id); }
  @Post('debts/:id/plan')
  addDebtPlan(@Param('id') id: string, @Body() body: any) { return this.service.addDebtPlan(id, body?.ym, body?.amount); }
  @Post('debts/:id/pay')
  payDebt(@Param('id') id: string, @Body() body: any) { return this.service.addPaidDebt(id, body?.ym, body?.amount, body?.account, body?.date); }
  @Post('debts/planned/:pid/pay')
  payDebtPlan(@Param('pid') pid: string, @Body() body: any) { return this.service.payDebtPlanned(pid, body?.account, body?.date); }
  @Post('debts/planned/:pid/unreceive')
  unreceiveDebtPlan(@Param('pid') pid: string) { return this.service.unreceivePlanned(pid); }
  @Delete('debts/planned/:pid')
  removeDebtPlan(@Param('pid') pid: string) { return this.service.removePlanned(pid); }

  // ─── Доходные матрицы / планируемые оплаты ────────────────────────
  @Get('income-matrix')
  incomeMatrix(@Query('group') group: string, @Query('start') start?: string, @Query('months') months?: string) {
    return this.service.incomeMatrix(group, start, months ? parseInt(months, 10) || 6 : 6);
  }
  @Post('planned')
  addPlanned(@Body() body: any) { return this.service.addPlannedPayment(body?.projectId, body?.ym, body?.partNo, body?.amount); }
  @Post('planned/received')
  addReceived(@Body() body: any) { return this.service.addReceivedPart(body?.projectId, body?.ym, body?.partNo, body?.amount, body?.account, body?.date); }
  @Post('planned/:pid/receive')
  receivePlan(@Param('pid') pid: string, @Body() body: any) { return this.service.receivePlanned(pid, body?.account, body?.date); }
  @Post('planned/:pid/unreceive')
  unreceivePlan(@Param('pid') pid: string) { return this.service.unreceivePlanned(pid); }
  @Delete('planned/:pid')
  removePlan(@Param('pid') pid: string) { return this.service.removePlanned(pid); }

  // ─── CRUD ────────────────────────────────────────────────────────
  @Get()
  findAll(
    @Query('account')  account?: FinanceAccount,
    @Query('type')     type?: FinanceTxType,
    @Query('category') category?: string,
    @Query('status')   status?: FinanceTxStatus,
    @Query('search')   search?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('sort')     sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc',
    @Query('page')     page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll({
      account, type, category, status, search, from, to, sort,
      page: page ? parseInt(page, 10) || 1 : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) || 15 : 15,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateFinanceTransactionDto, @Request() req) {
    return this.service.create(dto as any, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinanceTransactionDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
