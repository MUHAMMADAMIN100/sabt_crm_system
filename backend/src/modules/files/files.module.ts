import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { FileAttachment } from './file.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import * as fs from 'fs';

// Ensure upload dirs exist
['./uploads', './uploads/files', './uploads/avatars'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

@Module({
  imports: [
    TypeOrmModule.forFeature([FileAttachment]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads/files',
        filename: (req, file, cb) => {
          cb(null, `${uuidv4()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
