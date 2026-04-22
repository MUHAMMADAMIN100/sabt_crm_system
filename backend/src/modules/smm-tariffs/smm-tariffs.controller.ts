import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SmmTariffsService } from './smm-tariffs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('SMM Tariffs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('smm-tariffs')
export class SmmTariffsController {
  constructor(private service: SmmTariffsService) {}

  /** Список тарифов — видит любой авторизованный (нужно для дропдауна в проекте). */
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const filters: { search?: string; isActive?: boolean } = { search };
    if (isActive === 'true') filters.isActive = true;
    if (isActive === 'false') filters.isActive = false;
    return this.service.findAll(filters);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.HEAD_SMM)
  create(@Body() dto: any, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.HEAD_SMM)
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.HEAD_SMM)
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }

  @Post(':id/clone')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER, UserRole.HEAD_SMM)
  clone(@Param('id') id: string, @Request() req) {
    return this.service.clone(id, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.CO_FOUNDER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
