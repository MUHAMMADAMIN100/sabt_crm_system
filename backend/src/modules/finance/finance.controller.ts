import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import {
  FinanceAccount, FinanceCategory, FinanceTxStatus, FinanceTxType,
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

  // ─── CRUD ────────────────────────────────────────────────────────
  @Get()
  findAll(
    @Query('account')  account?: FinanceAccount,
    @Query('type')     type?: FinanceTxType,
    @Query('category') category?: FinanceCategory,
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
  create(@Body() dto: any, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
