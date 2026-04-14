import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { ClientLeadStatus, ClientLeadInterest } from './client-lead.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Client Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SALES_MANAGER)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get('stats')
  getStats() { return this.service.stats(); }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: ClientLeadStatus,
    @Query('interest') interest?: ClientLeadInterest,
    @Query('sphere') sphere?: string,
    @Query('ownerId') ownerId?: string,
    @Query('source') source?: string,
  ) {
    return this.service.findAll({ search, status, interest, sphere, ownerId, source });
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
