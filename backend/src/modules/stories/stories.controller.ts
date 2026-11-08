import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { cachedResponse } from '../../common/response-cache';

/** Короткий кэш сторис (08.11.2026): панели и проверка просят одно и то же
 *  по многу раз. Отметка сторис шлёт stories:changed — кэш сбрасывается
 *  сразу, так что минута здесь — только верхняя граница. */
const STORIES_TTL = 60_000;
/** «Сегодня» по Душанбе — от него зависят сводки проверки (будущие дни не
 *  считаются), поэтому оно в ключе: в полночь кэш не переживёт смену дня. */
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());

@ApiTags('Stories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('stories')
export class StoriesController {
  constructor(private service: StoriesService) {}

  @Get('my')
  getMy(@Request() req, @Query('from') from: string, @Query('to') to: string) {
    // Свои отметки — ключ по человеку.
    return cachedResponse(`stories:my:${req.user.id}:${from}:${to}`, STORIES_TTL,
      () => this.service.getByEmployee(req.user.id, from, to));
  }

  @Get()
  @RequirePerm('stories.view')
  getAll(@Query('from') from: string, @Query('to') to: string) {
    // Ответ одинаков для всех, у кого есть право stories.view (проверено гардом).
    return cachedResponse(`stories:all:${from}:${to}`, STORIES_TTL, () => this.service.getAll(from, to));
  }

  /** Сводка «кто отмечал сторис, а кто нет» — страница «Проверка сторис». */
  @Get('check')
  @RequirePerm('stories.view')
  check(@Query('from') from: string, @Query('to') to: string) {
    return cachedResponse(`stories:check:${from}:${to}:${todayKey()}`, STORIES_TTL, () => this.service.check(from, to));
  }

  /** Один день проверки — карточки SMM-специалистов с их проектами. */
  @Get('check/day')
  @RequirePerm('stories.view')
  checkDay(@Query('date') date: string) {
    return cachedResponse(`stories:check-day:${date}:${todayKey()}`, STORIES_TTL, () => this.service.checkDay(date));
  }

  @Post()
  @RequirePerm('stories.manage')
  upsert(@Request() req, @Body() body: { projectId: string; date: string; storiesCount: number }) {
    return this.service.upsert(req.user.id, body.projectId, body.date, body.storiesCount, req.user);
  }
}
