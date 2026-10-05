import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TransportService } from './transport.service';

/**
 * Фото чеков к заявкам на транспорт. Без JwtAuthGuard — как аватарки:
 * картинку открывают тегом <img> и ссылкой, без заголовка Authorization.
 * Ключ — случайный uuid; его видят только сам сотрудник и руководство.
 */
@ApiTags('Transport')
@Controller('transport-receipts')
export class TransportReceiptsController {
  constructor(private service: TransportService) {}

  @Get(':key')
  async get(@Param('key') key: string, @Res() res: Response) {
    const img = await this.service.getReceipt(key);
    if (!img) throw new NotFoundException('Фото чека не найдено');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // У каждой заявки свой ключ, картинка по нему не меняется.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(img.data);
  }
}
