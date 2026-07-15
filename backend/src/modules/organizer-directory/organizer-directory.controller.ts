import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard, RequirePerm } from '../auth/guards/permissions.guard';
import { OrganizerDirectoryService } from './organizer-directory.service';

const KINDS = ['clients', 'models', 'places'] as const;

/** Безопасная загрузка фото модели: только JPG/PNG/WEBP, максимум 5 МБ.
 *  Никаких SVG (XSS) и исполняемых файлов. Файл кладём в /uploads/models,
 *  в БД хранится только сгенерированное имя (uuid.ext). */
const MODEL_PHOTO_DIR = './uploads/models';
mkdirSync(MODEL_PHOTO_DIR, { recursive: true }); // multer не создаёт папку сам

const PHOTO_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const MODEL_PHOTO_MULTER_CONFIG = {
  storage: diskStorage({
    destination: MODEL_PHOTO_DIR,
    filename: (_req: any, file: Express.Multer.File, cb: any) => {
      const ext = extname(file.originalname).toLowerCase().slice(0, 8);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!PHOTO_ALLOWED_EXT.has(ext)) {
      return cb(new BadRequestException(`Фото: расширение ${ext} запрещено. Только JPG/PNG/WEBP.`), false);
    }
    if (!PHOTO_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new BadRequestException(`Фото: тип ${file.mimetype} запрещён.`), false);
    }
    cb(null, true);
  },
};

/** Справочники организатора съёмок (клиенты/модели/места).
 *  Доступ — грант organizer.directory: нативно organizer, smm_director и топ;
 *  остальным можно выдать через «Доступы сотрудников». RequirePerm стоит на
 *  КАЖДОМ обработчике: классовые метаданные гварды не читают. */
@ApiTags('Organizer Directory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('organizer-directory')
export class OrganizerDirectoryController {
  constructor(private service: OrganizerDirectoryService) {}

  @Get(':kind')
  @RequirePerm('organizer.directory')
  list(@Param('kind') kind: (typeof KINDS)[number], @Query('search') search?: string) {
    return this.service.list(kind, search);
  }

  /** Загрузка фото модели. Двусегментный путь (`models/photo`) не конфликтует
   *  с односегментным `:kind`. Возвращает имя файла — фронт кладёт его в поле
   *  photo при создании/обновлении записи. */
  @Post('models/photo')
  @RequirePerm('organizer.directory')
  @UseInterceptors(FileInterceptor('photo', MODEL_PHOTO_MULTER_CONFIG))
  uploadPhoto(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return { filename: file.filename };
  }

  @Post(':kind')
  @RequirePerm('organizer.directory')
  create(@Param('kind') kind: (typeof KINDS)[number], @Body() dto: any) {
    return this.service.create(kind, dto);
  }

  @Patch(':kind/:id')
  @RequirePerm('organizer.directory')
  update(@Param('kind') kind: (typeof KINDS)[number], @Param('id') id: string, @Body() dto: any) {
    return this.service.update(kind, id, dto);
  }

  @Delete(':kind/:id')
  @RequirePerm('organizer.directory')
  remove(@Param('kind') kind: (typeof KINDS)[number], @Param('id') id: string) {
    return this.service.remove(kind, id);
  }
}
