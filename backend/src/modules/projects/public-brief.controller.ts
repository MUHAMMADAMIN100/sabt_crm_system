import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ProjectsService } from './projects.service';

/**
 * Публичные эндпоинты для брифа клиента — без auth, по токену.
 * Менеджер генерирует ссылку (POST /projects/:id/brief/share-link),
 * получает URL вида `${APP_URL}/public/brief/<token>`, отправляет клиенту.
 * Клиент открывает страницу — фронт делает GET → получает текущий бриф
 * для пред-заполнения. После заполнения PATCH сохраняет ответы в проект.
 *
 * Безопасность: токен — 32 hex-символа (16 bytes random), невозможно
 * угадать. Доступа к чему-либо кроме брифа конкретного проекта токен
 * не даёт.
 */
@ApiTags('Public Brief')
@Controller('public/brief')
export class PublicBriefController {
  constructor(private service: ProjectsService) {}

  // Лёгкий троттл — клиент может перезагрузить страницу несколько раз.
  @Get(':token')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  get(@Param('token') token: string) {
    return this.service.getPublicBriefByToken(token);
  }

  @Patch(':token')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  save(@Param('token') token: string, @Body() body: any) {
    return this.service.savePublicBrief(token, body);
  }
}
