import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

/** Финансовый модуль — только основатель и сооснователь. */
@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER)
@Controller('finance')
export class FinanceController {
  constructor(private service: FinanceService) {}

  // ─── Дашборды / расчёты ──────────────────────────────────────────
  @Get('overview')
  overview(@Query('ym') ym: string) { return this.service.overview(ym || currentYm()); }

  @Get('income/directions')
  incomeDirections(@Query('ym') ym: string) { return this.service.incomeDirections(ym || currentYm()); }

  @Get('income/directions/:direction')
  incomeDirectionDetail(@Param('direction') direction: string, @Query('ym') ym: string) {
    return this.service.incomeDirectionDetail(direction, ym || currentYm());
  }

  @Get('expense/summary')
  expenseSummary(@Query('ym') ym: string) { return this.service.expenseSummary(ym || currentYm()); }

  @Get('expense/detail/:kind')
  expenseDetail(@Param('kind') kind: string, @Query('ym') ym: string) {
    return this.service.expenseDetail(kind, ym || currentYm());
  }

  @Get('accounts/balances')
  accountsBalances() { return this.service.accountsBalances(); }

  // ─── Транзакции ──────────────────────────────────────────────────
  @Get('transactions')
  transactions(
    @Query('type') type?: string, @Query('search') search?: string,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listTransactions({
      type, search, from, to,
      page: page ? parseInt(page, 10) || 1 : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) || 100 : 100,
    });
  }

  @Post('operations')
  createOperation(@Body() dto: any, @Request() req) { return this.service.createOperation(dto, req.user?.id); }

  @Patch('transactions/:id')
  updateTransaction(@Param('id') id: string, @Body() dto: any) { return this.service.updateTransaction(id, dto); }

  @Delete('transactions/:id')
  removeTransaction(@Param('id') id: string) { return this.service.removeTransaction(id); }

  // ─── Справочники: Счета ──────────────────────────────────────────
  @Get('accounts') listAccounts() { return this.service.listAccounts(); }
  @Post('accounts') createAccount(@Body() dto: any) { return this.service.createAccount(dto); }
  @Patch('accounts/:id') updateAccount(@Param('id') id: string, @Body() dto: any) { return this.service.updateAccount(id, dto); }
  @Delete('accounts/:id') removeAccount(@Param('id') id: string) { return this.service.removeAccount(id); }

  // ─── Справочники: Категории ──────────────────────────────────────
  @Get('categories') listCategories() { return this.service.listCategories(); }
  @Post('categories') createCategory(@Body() dto: any) { return this.service.createCategory(dto); }
  @Patch('categories/:id') updateCategory(@Param('id') id: string, @Body() dto: any) { return this.service.updateCategory(id, dto); }
  @Delete('categories/:id') removeCategory(@Param('id') id: string) { return this.service.removeCategory(id); }

  // ─── Справочники: Проекты/клиенты ────────────────────────────────
  @Get('projects') listProjects() { return this.service.listProjects(); }
  @Post('projects') createProject(@Body() dto: any) { return this.service.createProject(dto); }
  @Patch('projects/:id') updateProject(@Param('id') id: string, @Body() dto: any) { return this.service.updateProject(id, dto); }
  @Delete('projects/:id') removeProject(@Param('id') id: string) { return this.service.removeProject(id); }

  // ─── Справочники: Сотрудники ─────────────────────────────────────
  @Get('employees') listEmployees() { return this.service.listEmployees(); }
  @Post('employees') createEmployee(@Body() dto: any) { return this.service.createEmployee(dto); }
  @Patch('employees/:id') updateEmployee(@Param('id') id: string, @Body() dto: any) { return this.service.updateEmployee(id, dto); }
  @Delete('employees/:id') removeEmployee(@Param('id') id: string) { return this.service.removeEmployee(id); }

  // ─── Справочники: Аренда/подписки ────────────────────────────────
  @Get('subscriptions') listSubscriptions() { return this.service.listSubscriptions(); }
  @Post('subscriptions') createSubscription(@Body() dto: any) { return this.service.createSubscription(dto); }
  @Patch('subscriptions/:id') updateSubscription(@Param('id') id: string, @Body() dto: any) { return this.service.updateSubscription(id, dto); }
  @Delete('subscriptions/:id') removeSubscription(@Param('id') id: string) { return this.service.removeSubscription(id); }

  // ─── Справочники: Долги ──────────────────────────────────────────
  @Get('debts') listDebts() { return this.service.listDebts(); }
  @Post('debts') createDebt(@Body() dto: any) { return this.service.createDebt(dto); }
  @Patch('debts/:id') updateDebt(@Param('id') id: string, @Body() dto: any) { return this.service.updateDebt(id, dto); }
  @Delete('debts/:id') removeDebt(@Param('id') id: string) { return this.service.removeDebt(id); }

  // ─── Резервная копия / сброс ─────────────────────────────────────
  @Get('backup/export') exportAll() { return this.service.exportAll(); }
  @Post('backup/import') importAll(@Body() data: any) { return this.service.importAll(data); }
  @Post('reset') resetAll() { return this.service.resetAll(true); }
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
