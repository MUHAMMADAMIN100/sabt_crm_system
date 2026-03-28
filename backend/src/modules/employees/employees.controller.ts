import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
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
  @Roles(UserRole.ADMIN)
  getStats() { return this.service.getStats(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateEmployeeDto) { return this.service.create(dto); }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/toggle-sub-admin')
  @Roles(UserRole.ADMIN)
  toggleSubAdmin(@Param('id') id: string) {
    return this.service.toggleSubAdmin(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
