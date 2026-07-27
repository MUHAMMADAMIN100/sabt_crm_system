import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';

@ApiTags('Stories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('stories')
export class StoriesController {
  constructor(private service: StoriesService) {}

  @Get('my')
  getMy(@Request() req, @Query('from') from: string, @Query('to') to: string) {
    return this.service.getByEmployee(req.user.id, from, to);
  }

  @Get()
  @RequirePerm('stories.manage')
  getAll(@Query('from') from: string, @Query('to') to: string) {
    return this.service.getAll(from, to);
  }

  @Post()
  @RequirePerm('stories.manage')
  upsert(@Request() req, @Body() body: { projectId: string; date: string; storiesCount: number }) {
    return this.service.upsert(req.user.id, body.projectId, body.date, body.storiesCount);
  }
}
