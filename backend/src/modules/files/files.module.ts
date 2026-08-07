import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';
import { FileAttachment } from './file.entity';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { GatewayModule } from '../gateway/gateway.module';
import * as fs from 'fs';

/** MIME-типы, которые разрешено загружать. SVG ИСКЛЮЧЁН — он
 *  выполняет JavaScript при просмотре в браузере (stored-XSS).
 *  Если очень нужны векторы — добавляй конвертацию в PNG на бэке. */
const ALLOWED_MIMETYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

/** Расширения, заблокированные явно — даже если кто-то подделает MIME,
 *  имя файла само себя выдаёт. */
const FORBIDDEN_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.xml', '.js', '.mjs', '.cjs',
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.com',
  '.jar', '.apk', '.app', '.dmg', '.pkg', '.php', '.phtml', '.py', '.rb', '.pl',
]);

// Ensure upload dirs exist
['./uploads', './uploads/files', './uploads/avatars'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

@Module({
  imports: [
    TypeOrmModule.forFeature([FileAttachment, Task, Project]),
    GatewayModule,
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/files',
        filename: (req, file, cb) => {
          // Сохраняем только UUID + расширение из оригинального имени
          // (нормализованное к нижнему регистру). Никаких юзерских строк
          // в имени файла → защита от path-traversal и поддельных расширений.
          const ext = extname(file.originalname).toLowerCase().slice(0, 16);
          cb(null, `${uuidv4()}${ext}`);
        },
      }),
      limits: {
        fileSize: 25 * 1024 * 1024, // 25MB — больше пускать опасно (DoS диска)
        files: 1,
        fields: 20,
      },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (FORBIDDEN_EXTENSIONS.has(ext)) {
          return cb(
            new BadRequestException(`Расширение файла запрещено: ${ext}`),
            false,
          );
        }
        if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
          return cb(
            new BadRequestException(`Тип файла не разрешён: ${file.mimetype}`),
            false,
          );
        }
        cb(null, true);
      },
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
