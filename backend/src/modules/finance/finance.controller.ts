import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { FinanceScheduler } from './finance.scheduler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { FinanceAccessGuard } from './finance-access.guard';
import { UserRole } from '../users/user.entity';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { CreatePlannedPaymentDto } from './dto/create-planned-payment.dto';
import { UpdatePlannedPaymentDto } from './dto/update-planned-payment.dto';
import { ReceivePlannedPaymentDto } from './dto/receive-planned-payment.dto';
import { PayNowDto } from './dto/pay-now.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { SetEmployeeBonusDto } from './dto/set-employee-bonus.dto';
import { CreateAssetDto, UpdateAssetDto } from './dto/asset.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { MarkSubscriptionPaidDto } from './dto/mark-subscription-paid.dto';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { RemoveMonthExpensesDto } from './dto/remove-month-expenses.dto';

/** Финансовый модуль — только основатель и сооснователь (право finance.manage). */
@ApiTags('Finance')
@ApiBearerAuth()
// FinanceAccessGuard обязателен: RolesGuard/PermissionsGuard читают метаданные
// только с обработчиков, поэтому классовые @Roles/@RequirePerm сами по себе
// доступ не ограничивают.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, FinanceAccessGuard)
@Roles(UserRole.FOUNDER, UserRole.CO_FOUNDER)
@RequirePerm('finance.manage')
@Controller('finance')
export class FinanceController {
  constructor(
    private service: FinanceService,
    private scheduler: FinanceScheduler,
  ) {}

  /** Ручной запуск проверки сроков оплат (крон делает это ежедневно в 9:00). */
  @Post('reminders/run')
  runReminders() { return this.scheduler.runDueCheck(); }

  // ─── Дашборды / расчёты ──────────────────────────────────────────
  @Get('overview')
  overview(@Query('ym') ym: string) { return this.service.overview(ym || currentYm()); }

  @Get('income/directions')
  incomeDirections(@Query('ym') ym: string) { return this.service.incomeDirections(ym || currentYm()); }

  @Get('income/directions/:direction')
  incomeDirectionDetail(@Param('direction') direction: string, @Query('ym') ym: string, @Query('start') start?: string) {
    return this.service.incomeDirectionDetail(direction, ym || currentYm(), start);
  }

  @Get('expense/summary')
  expenseSummary(@Query('ym') ym: string) { return this.service.expenseSummary(ym || currentYm()); }

  @Get('expense/detail/:kind')
  expenseDetail(@Param('kind') kind: string, @Query('ym') ym: string, @Query('start') start?: string) {
    return this.service.expenseDetail(kind, ym || currentYm(), start);
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
  createOperation(@Body() dto: CreateOperationDto, @Request() req) { return this.service.createOperation(dto, req.user?.id); }

  @Patch('transactions/:id')
  updateTransaction(@Param('id') id: string, @Body() dto: UpdateTransactionDto) { return this.service.updateTransaction(id, dto); }

  @Delete('transactions/:id')
  removeTransaction(@Param('id') id: string) { return this.service.removeTransaction(id); }

  /** Снять расходы месяца по сотруднику/подписке одной транзакцией. */
  @Post('operations/remove-month')
  removeMonthExpenses(@Body() dto: RemoveMonthExpensesDto) { return this.service.removeMonthExpenses(dto); }

  // ─── Плановые оплаты (SMM части, матрицы Dev/Design, график долгов) ──
  @Get('planned-payments')
  listPlanned(@Query('projectId') projectId?: string, @Query('debtId') debtId?: string, @Query('ym') ym?: string) {
    return this.service.listPlannedPayments({ projectId, debtId, ym });
  }
  @Post('planned-payments')
  createPlanned(@Body() dto: CreatePlannedPaymentDto) { return this.service.createPlannedPayment(dto); }
  /** Правка ожидаемого плана: сумма и/или срок. */
  @Patch('planned-payments/:id')
  updatePlanned(@Param('id') id: string, @Body() dto: UpdatePlannedPaymentDto) { return this.service.updatePlannedPayment(id, dto); }
  @Post('planned-payments/pay-now')
  payNow(@Body() dto: PayNowDto) { return this.service.payNow(dto); }
  @Post('planned-payments/:id/receive')
  receivePlanned(@Param('id') id: string, @Body() dto: ReceivePlannedPaymentDto) { return this.service.receivePlannedPayment(id, dto); }
  @Post('planned-payments/:id/unreceive')
  unreceivePlanned(@Param('id') id: string) { return this.service.unreceivePlannedPayment(id); }
  @Delete('planned-payments/:id')
  removePlanned(@Param('id') id: string) { return this.service.removePlannedPayment(id); }

  // ─── Справочники: Счета ──────────────────────────────────────────
  @Get('accounts') listAccounts() { return this.service.listAccounts(); }
  @Post('accounts') createAccount(@Body() dto: CreateAccountDto) { return this.service.createAccount(dto); }
  @Patch('accounts/:id') updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto) { return this.service.updateAccount(id, dto); }
  @Delete('accounts/:id') removeAccount(@Param('id') id: string) { return this.service.removeAccount(id); }

  // ─── Справочники: Категории ──────────────────────────────────────
  @Get('categories') listCategories() { return this.service.listCategories(); }
  @Post('categories') createCategory(@Body() dto: CreateCategoryDto) { return this.service.createCategory(dto); }
  @Patch('categories/:id') updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete('categories/:id') removeCategory(@Param('id') id: string) { return this.service.removeCategory(id); }

  // ─── Справочники: Проекты/клиенты ────────────────────────────────
  @Get('projects') listProjects() { return this.service.listProjects(); }
  @Post('projects') createProject(@Body() dto: CreateProjectDto) { return this.service.createProject(dto); }
  @Patch('projects/:id') updateProject(@Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.service.updateProject(id, dto); }
  @Delete('projects/:id') removeProject(@Param('id') id: string) { return this.service.removeProject(id); }
  /** Отменить все оплаты проекта (планы + операции) одной транзакцией. */
  @Post('projects/:id/cancel-payments') cancelProjectPayments(@Param('id') id: string) { return this.service.cancelProjectPayments(id); }

  // ─── Справочники: Сотрудники ─────────────────────────────────────
  @Get('employees') listEmployees() { return this.service.listEmployees(); }
  @Post('employees') createEmployee(@Body() dto: CreateEmployeeDto) { return this.service.createEmployee(dto); }
  @Patch('employees/:id') updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) { return this.service.updateEmployee(id, dto); }
  @Delete('employees/:id') removeEmployee(@Param('id') id: string) { return this.service.removeEmployee(id); }
  /** Бонус сотрудника за месяц (входит в «к выплате»; 0 — снять). */
  @Post('employees/:id/bonus') setEmployeeBonus(@Param('id') id: string, @Body() dto: SetEmployeeBonusDto) { return this.service.setEmployeeBonus(id, dto); }

  // ─── Справочники: Аренда/подписки ────────────────────────────────
  @Get('subscriptions') listSubscriptions() { return this.service.listSubscriptions(); }
  @Post('subscriptions') createSubscription(@Body() dto: CreateSubscriptionDto) { return this.service.createSubscription(dto); }
  @Patch('subscriptions/:id') updateSubscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) { return this.service.updateSubscription(id, dto); }
  @Delete('subscriptions/:id') removeSubscription(@Param('id') id: string) { return this.service.removeSubscription(id); }
  /** Отметить месяц оплаченным без операции (балансы не меняются). */
  @Post('subscriptions/:id/mark-paid') markSubscriptionPaid(@Param('id') id: string, @Body() dto: MarkSubscriptionPaidDto) { return this.service.markSubscriptionPaid(id, dto); }
  @Post('subscriptions/:id/unmark-paid') unmarkSubscriptionPaid(@Param('id') id: string, @Body() dto: MarkSubscriptionPaidDto) { return this.service.unmarkSubscriptionPaid(id, dto); }

  // ─── Справочники: Долги ──────────────────────────────────────────
  @Get('debts') listDebts() { return this.service.listDebts(); }
  @Post('debts') createDebt(@Body() dto: CreateDebtDto) { return this.service.createDebt(dto); }
  @Patch('debts/:id') updateDebt(@Param('id') id: string, @Body() dto: UpdateDebtDto) { return this.service.updateDebt(id, dto); }
  @Delete('debts/:id') removeDebt(@Param('id') id: string) { return this.service.removeDebt(id); }
  @Post('debts/:id/regenerate-schedule') regenerateSchedule(@Param('id') id: string) { return this.service.regenerateDebtScheduleById(id); }

  // ─── Инвентарь (оборудование + амортизация) ──────────────────────
  @Get('assets') listAssets() { return this.service.listAssets(); }
  @Post('assets') createAsset(@Body() dto: CreateAssetDto) { return this.service.createAsset(dto); }
  @Patch('assets/:id') updateAsset(@Param('id') id: string, @Body() dto: UpdateAssetDto) { return this.service.updateAsset(id, dto); }
  @Delete('assets/:id') removeAsset(@Param('id') id: string) { return this.service.removeAsset(id); }

  // ─── Резервная копия / сброс ─────────────────────────────────────
  @Get('backup/export') exportAll() { return this.service.exportAll(); }
  @Post('backup/import') importAll(@Body() data: any) { return this.service.importAll(data); }
  @Post('reset') resetAll() { return this.service.resetAll(true); }

  // ─── Снимки данных (автобэкап) ───────────────────────────────────
  @Get('backups') listBackups() { return this.service.listBackups(); }
  @Post('backups') createBackup() { return this.service.createBackupSnapshot('manual'); }
  @Get('backups/:id') getBackup(@Param('id') id: string) { return this.service.getBackup(id); }
  @Post('backups/:id/restore') restoreBackup(@Param('id') id: string) { return this.service.restoreBackup(id); }
}

/** Текущий месяц по Душанбе — сервер живёт в UTC. */
function currentYm(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date()).slice(0, 7);
}
