import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/create-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { EmployeeStatus } from './employee.entity';

@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private service: EmployeesService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('status') status?: EmployeeStatus,
  ) {
    return this.service.findAll(search, department, status);
  }

  @Get('departments')
  getDepartments() { return this.service.getDepartments(); }

  @Get('stats')
  getStats() { return this.service.getStats(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  create(@Body() dto: CreateEmployeeDto) { return this.service.create(dto); }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Request() req) {
    if ('salary' in dto && req.user?.role !== 'founder') {
      throw new ForbiddenException('Только основатель может изменять зарплату сотрудника');
    }
    return this.service.update(id, dto);
  }

  @Patch(':id/toggle-sub-admin')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  toggleSubAdmin(@Param('id') id: string) {
    return this.service.toggleSubAdmin(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
