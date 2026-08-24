import {
  Controller, Get, Post, Delete, Param, Body, Query, UseGuards, UseInterceptors,
  UploadedFile, Request, Res, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TeamStoriesService, STORY_EMOJI } from './team-stories.service';

/** Файл едет в память и уходит в базу: диск на Railway эфемерный, при
 *  редеплое сторис исчезли бы раньше своих суток. */
const STORY_UPLOAD = {
  storage: memoryStorage(),
  limits: { fileSize: 13 * 1024 * 1024, files: 1 },
};

/**
 * Отдача медиа — отдельным контроллером без JwtAuthGuard: браузер тянет
 * картинку тегом <img>, а видео — тегом <video>, и заголовок Authorization
 * туда не подставить. Ключ ссылки случайный, перебрать нельзя.
 */
@ApiTags('TeamStories')
@Controller('team-stories/media')
export class TeamStoriesMediaController {
  constructor(private service: TeamStoriesService) {}

  @Get(':key')
  @SkipThrottle()
  async media(@Param('key') key: string, @Request() req, @Res() res: Response): Promise<void> {
    const m = await this.service.getMedia(key);
    if (!m) throw new NotFoundException('Файл не найден');

    res.setHeader('Content-Type', m.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Ключ у каждой сторис свой и не переиспользуется — можно кэшировать
    // надолго, устаревшей эта ссылка не станет.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');

    // Перемотка видео: без обработки Range браузер не даёт двигать ползунок,
    // а Safari вообще отказывается проигрывать файл.
    const range = req.headers?.range as string | undefined;
    const total = m.data.length;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
      if (Number.isNaN(start) || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      const last = Math.min(end, total - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${last}/${total}`);
      res.setHeader('Content-Length', last - start + 1);
      // Именно res.end(), а НЕ return res.end(): вернув объект ответа, мы
      // отдали бы его Nest'у на сериализацию — тот пытался дописать уже
      // закрытый ответ, и процесс падал с внутренней ошибкой Node.
      res.end(m.data.subarray(start, last + 1));
      return;
    }
    res.setHeader('Content-Length', total);
    res.end(m.data);
  }
}

/**
 * Лента команды: внутренние сторис сотрудников. Доступна всем, кто вошёл
 * в систему, — это общая лента компании, ролевых ограничений нет.
 */
@ApiTags('TeamStories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('team-stories')
export class TeamStoriesController {
  constructor(private service: TeamStoriesService) {}

  @Get()
  feed(@Request() req) {
    return this.service.feed(req.user.id);
  }

  /** Набор доступных реакций отдаём с сервера — чтобы интерфейс и проверка
   *  на сервере не разошлись со временем. */
  @Get('emoji')
  emoji() {
    return STORY_EMOJI;
  }

  @Post()
  @UseInterceptors(FileInterceptor('media', STORY_UPLOAD))
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { caption?: string; durationSec?: string },
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('Выберите фото или видео');
    return this.service.create(file, body?.caption || '', Number(body?.durationSec || 0), req.user);
  }

  @Post(':id/view')
  view(@Param('id') id: string, @Request() req) {
    return this.service.markViewed(id, req.user);
  }

  @Post(':id/reaction')
  react(@Param('id') id: string, @Body() body: { emoji?: string }, @Request() req) {
    return this.service.react(id, String(body?.emoji || ''), req.user);
  }

  @Get(':id/comments')
  comments(@Param('id') id: string) {
    return this.service.listComments(id);
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() body: { text?: string }, @Request() req) {
    return this.service.addComment(id, body?.text || '', req.user);
  }

  @Get(':id/viewers')
  viewers(@Param('id') id: string, @Request() req) {
    return this.service.viewers(id, req.user);
  }

  @Delete('comments/:commentId')
  removeComment(@Param('commentId') commentId: string, @Request() req) {
    return this.service.removeComment(commentId, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.service.remove(id, req.user);
  }
}
