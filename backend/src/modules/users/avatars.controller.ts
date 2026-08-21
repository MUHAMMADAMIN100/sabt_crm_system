import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UsersService } from './users.service';

/**
 * Отдача фотографий сотрудников. Отдельный контроллер без JwtAuthGuard —
 * браузер грузит картинку тегом <img>, без заголовка Authorization, а на
 * cookie полагаться нельзя: Safari режет их для стороннего домена. Раньше
 * аватарки лежали в /uploads и были доступны так же без авторизации, так
 * что уровень доступа не изменился; ключ — случайный uuid, перебрать его
 * или узнать по нему сотрудника нельзя.
 */
@ApiTags('Users')
@Controller('avatars')
export class AvatarsController {
  constructor(private usersService: UsersService) {}

  @Get(':key')
  // На странице сотрудников таких запросов сразу десятки — общий лимит
  // на них тратить незачем, тем более что дальше их отдаёт кэш браузера.
  @SkipThrottle()
  async get(@Param('key') key: string, @Res() res: Response) {
    const img = await this.usersService.getAvatarImage(key);
    if (!img) throw new NotFoundException('Фотография не найдена');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ключ меняется при каждой загрузке нового фото, поэтому картинку можно
    // кэшировать «навсегда»: устаревшей она не бывает.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(img.data);
  }
}
