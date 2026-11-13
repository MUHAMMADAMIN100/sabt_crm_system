import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdirSync, statSync } from 'fs';
import { rm, stat, writeFile } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DirectAttachmentKind } from './direct.entity';

/** Файл от клиента — не больше этого; сам Instagram ограничивает 25 МБ. */
export const MAX_INCOMING_SIZE = 25 * 1024 * 1024;
/** Что отправляем мы: фото до 8 МБ, PDF до 25 МБ — как принимает Instagram. */
export const MAX_PICTURE_SIZE = 8 * 1024 * 1024;
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
/** Голосовое из CRM: пять минут весят гораздо меньше. */
export const MAX_VOICE_SIZE = 10 * 1024 * 1024;
/** Фото профиля весит немного; больше — уже не фото. */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  // Всё прочее отдаём байтами на скачивание — браузер такое не открывает.
  '.bin': 'application/octet-stream',
};

const EXTENSIONS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TYPES).map(([extension, type]) => [type, extension])),
  'image/jpg': '.jpg',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/wave': '.wav',
  'audio/x-wav': '.wav',
};

const FALLBACK: Partial<Record<DirectAttachmentKind, string>> = {
  image: '.jpg',
  sticker: '.png',
  video: '.mp4',
  audio: '.m4a',
  story: '.mp4',
  reel: '.mp4',
  share: '.jpg',
};

/** Имена даёт сама CRM: ничего другого из папки не читается. */
const NAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

const startsWith = (bytes: Buffer, ...signature: number[]): boolean => bytes.subarray(0, signature.length).equals(Buffer.from(signature));

/** Контейнеры, в которых пишет звук браузер: WebM (Chrome), Ogg (Firefox), MP4 (Safari), WAV. */
const looksLikeSound = (bytes: Buffer): boolean =>
  startsWith(bytes, 0x1a, 0x45, 0xdf, 0xa3) ||
  bytes.subarray(0, 4).toString('latin1') === 'OggS' ||
  bytes.subarray(4, 8).toString('latin1') === 'ftyp' ||
  (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WAVE');

/** Видео MP4/MOV: контейнер ISO с меткой ftyp на пятом байте. */
const looksLikeVideo = (bytes: Buffer): boolean => bytes.subarray(4, 8).toString('latin1') === 'ftyp';

/** Что принимает Instagram: JPG и PNG как фото, MP4 и MOV как видео, PDF как
 *  документ. Тип проверяем по первым байтам, а не только по расширению. */
const OUTGOING: Record<string, { kind: 'image' | 'video' | 'file'; maxSize: number; looksRight: (bytes: Buffer) => boolean }> = {
  '.jpg': { kind: 'image', maxSize: MAX_PICTURE_SIZE, looksRight: (bytes) => startsWith(bytes, 0xff, 0xd8, 0xff) },
  '.jpeg': { kind: 'image', maxSize: MAX_PICTURE_SIZE, looksRight: (bytes) => startsWith(bytes, 0xff, 0xd8, 0xff) },
  '.png': { kind: 'image', maxSize: MAX_PICTURE_SIZE, looksRight: (bytes) => startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  '.mp4': { kind: 'video', maxSize: MAX_DOCUMENT_SIZE, looksRight: looksLikeVideo },
  '.mov': { kind: 'video', maxSize: MAX_DOCUMENT_SIZE, looksRight: looksLikeVideo },
  '.pdf': { kind: 'file', maxSize: MAX_DOCUMENT_SIZE, looksRight: (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-' },
};

const TOO_BIG: Record<'image' | 'video' | 'file', string> = {
  image: 'Фото больше 8 МБ — Instagram его не примет',
  video: 'Видео больше 25 МБ — Instagram его не примет',
  file: 'PDF больше 25 МБ — Instagram его не примет',
};

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  storedName: string;
  mimeType: string;
  size: number;
}

export interface OpenedFile {
  /** Полный путь — файл отдаёт express sendFile (докачка, Range для Safari). */
  path: string;
  type: string;
  size: number;
}

export interface OutgoingFile {
  kind: 'image' | 'video' | 'file';
  name: string;
  bytes: Buffer;
  extension: string;
}

/** Ссылки на файлы переписки живут сутки: картинка в <img> не может
 *  прислать заголовок входа, поэтому ссылка подписана. */
const MEDIA_LINK_TTL_S = 24 * 60 * 60;

/**
 * Файлы переписки: что прислали клиенты, их фото и что отправляем мы.
 * Лежат в uploads/direct — на постоянном томе Railway (/app/uploads), отдельно
 * от вложений задач. Отдаются только через контроллеры «Директа».
 */
@Injectable()
export class DirectFiles {
  private readonly logger = new Logger(DirectFiles.name);
  private readonly root = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
  private readonly dir = join(this.root, 'direct');
  private readonly signingKey = createHash('sha256').update(`direct-media:${process.env.JWT_SECRET || ''}`).digest();

  constructor() {
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch (e: any) {
      this.logger.warn(`Папка файлов «Директа» не создана: ${e?.message || e}`);
    }
  }

  /** Постоянное ли хранилище: том Railway смонтирован отдельным диском, и
   *  у папки uploads другой номер устройства, чем у папки приложения. */
  storageIsPersistent(): boolean | null {
    try {
      return statSync(this.root).dev !== statSync(dirname(this.root)).dev;
    } catch {
      return null;
    }
  }

  async save(bytes: Buffer, type: string | null, kind: DirectAttachmentKind): Promise<StoredFile> {
    const named = type?.split(';')[0].trim().toLowerCase();
    const extension = (named && EXTENSIONS[named]) || FALLBACK[kind] || '.bin';
    return this.write(bytes, extension);
  }

  checkOutgoing(file: UploadedFile | undefined): OutgoingFile {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не выбран');
    // multer читает имя как Latin-1, а браузер шлёт UTF-8.
    const name = Buffer.from(file.originalname || 'file', 'latin1').toString('utf8').slice(0, 200);
    const extension = extname(name).toLowerCase();
    const rule = OUTGOING[extension];
    if (!rule || !rule.looksRight(file.buffer)) {
      throw new BadRequestException('Instagram принимает только фото JPG и PNG, видео MP4 и MOV и документы PDF');
    }
    if (file.size > rule.maxSize) throw new BadRequestException(TOO_BIG[rule.kind]);
    return { kind: rule.kind, name, bytes: file.buffer, extension: extension === '.jpeg' ? '.jpg' : extension };
  }

  checkVoice(file: UploadedFile | undefined): Buffer {
    if (!file?.buffer?.length) throw new BadRequestException('Запись пустая');
    if (!looksLikeSound(file.buffer)) throw new BadRequestException('Это не запись голоса');
    if (file.size > MAX_VOICE_SIZE) throw new BadRequestException('Голосовое слишком длинное');
    return file.buffer;
  }

  async saveOutgoing(file: OutgoingFile): Promise<StoredFile> {
    return this.write(file.bytes, file.extension);
  }

  async saveSound(bytes: Buffer): Promise<StoredFile> {
    return this.write(bytes, '.m4a');
  }

  async open(storedName: string): Promise<OpenedFile> {
    if (!NAME_PATTERN.test(storedName)) throw new NotFoundException();
    const path = join(this.dir, storedName);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Файл не найден');
    return { path: resolve(path), type: TYPES[extname(storedName)] ?? TYPES['.bin'], size: info.size };
  }

  async remove(storedName: string | null | undefined): Promise<void> {
    if (storedName && NAME_PATTERN.test(storedName)) await rm(join(this.dir, storedName), { force: true });
  }

  /** Подписанная ссылка на файл переписки или фото собеседника. */
  signedPath(kind: 'media' | 'avatar', id: string, now = Date.now()): string {
    // Срок округлён до часа: ссылка не меняется при каждом обновлении списка,
    // и браузер берёт фото из кэша, а не качает заново. Живёт 24–25 часов.
    const e = (Math.floor(now / 1000 / 3600) + 1) * 3600 + MEDIA_LINK_TTL_S;
    return `/api/direct/${kind}/${id}?e=${e}&s=${this.sign(kind, id, e)}`;
  }

  verify(kind: 'media' | 'avatar', id: string, e: string | undefined, s: string | undefined, now = Date.now()): boolean {
    const expires = Number(e);
    if (!Number.isFinite(expires) || expires * 1000 < now || !s) return false;
    const expected = Buffer.from(this.sign(kind, id, expires));
    const given = Buffer.from(String(s));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sign(kind: string, id: string, expires: number): string {
    return createHmac('sha256', this.signingKey).update(`${kind}:${id}:${expires}`).digest('base64url');
  }

  private async write(bytes: Buffer, extension: string): Promise<StoredFile> {
    // Имя на диске — наше: имя снаружи могло бы указать за пределы папки.
    const storedName = `${randomUUID()}${extension}`;
    await writeFile(join(this.dir, storedName), bytes);
    return { storedName, mimeType: TYPES[extension] ?? TYPES['.bin'], size: bytes.length };
  }
}
