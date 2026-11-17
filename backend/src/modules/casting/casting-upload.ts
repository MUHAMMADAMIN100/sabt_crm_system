import { BadRequestException } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { extname } from 'path';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';

/**
 * Загрузка фото кастинга (17.11.2026): только JPG/PNG/WEBP до 8 МБ. Файл
 * ложится в ./uploads/casting под случайным именем uuid.ext — никаких
 * имён от пользователя на диске (path traversal, подмена расширения). SVG
 * нет: он исполняет JavaScript при просмотре. Отдаётся статикой
 * /uploads/casting/… (main.ts), как остальные uploads.
 */
export const CASTING_DIR = './uploads/casting';
export const CASTING_URL_PREFIX = '/uploads/casting/';
mkdirSync(CASTING_DIR, { recursive: true }); // multer сам папку не создаёт

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** Фото за одну загрузку в карточке. */
export const MAX_PHOTOS_PER_UPLOAD = 10;
/** Фото за один импорт. */
export const MAX_IMPORT_PHOTOS = 150;

export const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
export const PHOTO_MIME = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp']);

export const isPhotoFile = (file: { originalname?: string; mimetype?: string }) =>
  PHOTO_EXT.has(extname(String(file?.originalname || '')).toLowerCase()) && PHOTO_MIME.has(String(file?.mimetype || '').toLowerCase());

/** Имя на диске: uuid + расширение (.jpeg → .jpg). */
export function storedPhotoName(originalname: string): string {
  const ext = extname(String(originalname || '')).toLowerCase();
  return `${uuidv4()}${ext === '.jpeg' ? '.jpg' : PHOTO_EXT.has(ext) ? ext : '.jpg'}`;
}

/** Путь из базы → безопасное имя файла в CASTING_DIR (или null). */
export function storedNameOf(path: unknown): string | null {
  const s = typeof path === 'string' ? path : '';
  if (!s.startsWith(CASTING_URL_PREFIX)) return null;
  const name = s.slice(CASTING_URL_PREFIX.length);
  return /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i.test(name) ? name : null;
}

/** Фото в карточку: поле files, до 10 штук. Не фото — 400. */
export const PHOTO_MULTER = {
  storage: diskStorage({
    destination: CASTING_DIR,
    filename: (_req: any, file: Express.Multer.File, cb: any) => cb(null, storedPhotoName(file.originalname)),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_UPLOAD, fields: 10 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (!isPhotoFile(file)) {
      return cb(new BadRequestException('Фото — только JPG, PNG или WEBP'), false);
    }
    cb(null, true);
  },
};

/** JSON-файл (data.json): по расширению или типу. */
export const isJsonFile = (file: { originalname?: string; mimetype?: string }) =>
  extname(String(file?.originalname || '')).toLowerCase() === '.json' || String(file?.mimetype || '').toLowerCase().includes('json');

/** Импорт: поле data — data.json (во временную папку, после разбора
 *  удаляется), поле files — фото. Если выбрали всю папку и data.json
 *  пришёл среди files — тоже примем (во временную папку). Прочие файлы из
 *  папки молча пропускаем: если на них ссылается data.json, они попадут в
 *  «не найдено». */
export const IMPORT_MULTER = {
  storage: diskStorage({
    destination: (_req: any, file: Express.Multer.File, cb: any) =>
      cb(null, file.fieldname === 'data' || isJsonFile(file) ? tmpdir() : CASTING_DIR),
    filename: (_req: any, file: Express.Multer.File, cb: any) =>
      cb(null, file.fieldname === 'data' || isJsonFile(file) ? `casting-import-${uuidv4()}.json` : storedPhotoName(file.originalname)),
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_IMPORT_PHOTOS + 1, fields: 10 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (file.fieldname === 'data') {
      if (!isJsonFile(file)) return cb(new BadRequestException('Поле data — файл data.json'), false);
      return cb(null, true);
    }
    cb(null, isPhotoFile(file) || isJsonFile(file));
  },
};
