import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Request, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { SalesService } from './sales.service';
import { SalesAnalyticsService } from './sales-analytics.service';
import {
  CallDto, CommentDto, EmailDto, HandoffDto, LinkProjectDto, MeetingResultDto, SalesSettingsDto,
} from './dto/sales.dto';

/**
 * /api/sales/* (15.11.2026) — договор docs/SALES_SPEC.md §5.
 *
 * Права — @RequirePerm на КАЖДОМ обработчике (классовый @Roles RolesGuard не
 * читает). Тонкие правила — в сервисах:
 *  - действия над лидом: владелец / ничей лид своего направления / руководство;
 *  - «Заявки от продаж»: руководство и руководители направлений (ключ
 *    projects.edit есть ровно у них), связь с проектом — руководство;
 *  - настройки: читать — clients.view (МП — нормы и свой процент), менять —
 *    clients.kpi.all (руководство), комиссию — только основатель.
 */
@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly analyticsService: SalesAnalyticsService,
  ) {}

  @Get('agenda')
  @RequirePerm('clients.view')
  agenda(@Request() req) {
    return this.sales.agenda(req.user);
  }

  @Post('leads/:id/calls')
  @RequirePerm('clients.edit')
  call(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CallDto, @Request() req) {
    return this.sales.logCall(id, dto, req.user);
  }

  @Post('leads/:id/emails')
  @RequirePerm('clients.edit')
  email(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EmailDto, @Request() req) {
    return this.sales.logEmail(id, dto, req.user);
  }

  @Post('leads/:id/meeting')
  @RequirePerm('clients.edit')
  meeting(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MeetingResultDto, @Request() req) {
    return this.sales.meetingResult(id, dto, req.user);
  }

  @Get('leads/:id/events')
  @RequirePerm('clients.view')
  events(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.sales.events(id, req.user);
  }

  @Post('leads/:id/comments')
  @RequirePerm('clients.edit')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto, @Request() req) {
    return this.sales.addComment(id, dto, req.user);
  }

  @Post('leads/:id/handoff')
  @RequirePerm('clients.edit')
  handoff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HandoffDto, @Request() req) {
    return this.sales.handoff(id, dto, req.user);
  }

  @Get('handoffs')
  @RequirePerm('projects.edit')
  handoffs(@Query('status') status: string | undefined, @Request() req) {
    return this.sales.handoffs(req.user, status);
  }

  @Post('handoffs/:leadId/link')
  @RequirePerm('projects.edit')
  link(@Param('leadId', ParseUUIDPipe) leadId: string, @Body() dto: LinkProjectDto, @Request() req) {
    return this.sales.linkProject(leadId, dto, req.user);
  }

  @Get('analytics')
  @RequirePerm('clients.kpi.all')
  analytics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('direction') direction?: string,
  ) {
    return this.analyticsService.analytics(from, to, direction);
  }

  @Get('settings')
  @RequirePerm('clients.view')
  settings(@Request() req) {
    return this.analyticsService.getSettings(req.user);
  }

  @Put('settings')
  @RequirePerm('clients.kpi.all')
  saveSettings(@Body() dto: SalesSettingsDto, @Request() req) {
    return this.analyticsService.saveSettings(req.user, dto);
  }
}
