import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  findAll(
    @Query('employeeId') employeeId?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll({ employeeId, projectId, from, to });
  }

  @Get('export/csv')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER)
  async exportCsv(
    @Query('employeeId') employeeId: string,
    @Query('projectId') projectId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const reports = await this.service.findAll({ employeeId, projectId, from, to });
    const header = 'ID,Date,Employee,Project,Task,Hours,Description\n';
    const rows = reports.map(r =>
      [
        r.id,
        r.date ? new Date(r.date).toISOString().split('T')[0] : '',
        `"${(r.employee?.name || '').replace(/"/g, '""')}"`,
        `"${(r.project?.name || '').replace(/"/g, '""')}"`,
        `"${(r.task?.title || '').replace(/"/g, '""')}"`,
        r.timeSpent ?? 0,
        `"${(r.description || '').replace(/"/g, '""')}"`,
      ].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reports.csv"');
    res.send('\uFEFF' + header + rows);
  }

  @Get('my')
  getMyReports(@Request() req) {
    return this.service.getMyReports(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: { date: string; projectId?: string; taskId?: string; description: string; timeSpent: number; comments?: string; files?: string[] }, @Request() req) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: { date?: string; projectId?: string; taskId?: string; description?: string; timeSpent?: number; comments?: string; files?: string[] }, @Request() req) {
    return this.service.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FOUNDER)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
