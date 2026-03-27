import { Controller, Get, Patch, Delete, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  findAll(@Request() req, @Query('unread') unread?: string) {
    return this.service.findByUser(req.user.id, unread === 'true');
  }

  @Get('unread-count')
  countUnread(@Request() req) {
    return this.service.countUnread(req.user.id).then(count => ({ count }));
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req) {
    return this.service.markRead(id, req.user.id);
  }

  @Patch('read-all')
  markAllRead(@Request() req) {
    return this.service.markAllRead(req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user.id);
  }
}
