import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SmmTariffsService } from './smm-tariffs.service';
import { CreateSmmTariffDto } from './dto/create-smm-tariff.dto';
import { UpdateSmmTariffDto } from './dto/update-smm-tariff.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('SMM Tariffs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('smm-tariffs')
export class SmmTariffsController {
  constructor(private service: SmmTariffsService) {}

  /** Список тарифов — видит любой авторизованный (нужно для дропдауна в проекте).
   *  Цены (monthlyPrice) показываются ТОЛЬКО founder/co_founder; для остальных
   *  ролей сервис вырезает поле в stripPrice(). */
  @Get()
  findAll(
    @Request() req,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const filters: { search?: string; isActive?: boolean } = { search };
    if (isActive === 'true') filters.isActive = true;
    if (isActive === 'false') filters.isActive = false;
    return this.service.findAll(filters, req.user?.role);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.user?.role);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.HEAD_SMM)
  create(@Body() dto: CreateSmmTariffDto, @Request() req) {
    return this.service.create(dto as any, req.user.id, req.user.role);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.HEAD_SMM)
  update(@Param('id') id: string, @Body() dto: UpdateSmmTariffDto, @Request() req) {
    return this.service.update(id, dto as any, req.user.role);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.HEAD_SMM)
  toggleActive(@Param('id') id: string, @Request() req) {
    return this.service.toggleActive(id, req.user.role);
  }

  @Post(':id/clone')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.SMM_DIRECTOR, UserRole.HEAD_SMM)
  clone(@Param('id') id: string, @Request() req) {
    return this.service.clone(id, req.user.id, req.user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
