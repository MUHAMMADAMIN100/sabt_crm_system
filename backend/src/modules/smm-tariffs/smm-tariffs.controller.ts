import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SmmTariffsService } from './smm-tariffs.service';
import { CreateSmmTariffDto } from './dto/create-smm-tariff.dto';
import { UpdateSmmTariffDto } from './dto/update-smm-tariff.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('SMM Tariffs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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
  @RequirePerm('tariffs.manage')
  create(@Body() dto: CreateSmmTariffDto, @Request() req) {
    return this.service.create(dto as any, req.user.id, req.user.role);
  }

  @Patch(':id')
  @RequirePerm('tariffs.manage')
  update(@Param('id') id: string, @Body() dto: UpdateSmmTariffDto, @Request() req) {
    return this.service.update(id, dto as any, req.user.role);
  }

  @Patch(':id/toggle-active')
  @RequirePerm('tariffs.manage')
  toggleActive(@Param('id') id: string, @Request() req) {
    return this.service.toggleActive(id, req.user.role);
  }

  @Post(':id/clone')
  @RequirePerm('tariffs.manage')
  clone(@Param('id') id: string, @Request() req) {
    return this.service.clone(id, req.user.id, req.user.role);
  }

  @Delete(':id')
  @RequirePerm('tariffs.delete')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
