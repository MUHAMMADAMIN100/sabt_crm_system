import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileAttachment } from './file.entity';
import * as fs from 'fs';

@Injectable()
export class FilesService {
  constructor(@InjectRepository(FileAttachment) private repo: Repository<FileAttachment>) {}

  findByProject(projectId: string) {
    return this.repo.find({ where: { projectId }, relations: ['uploadedBy'], order: { createdAt: 'DESC' } });
  }

  findByTask(taskId: string) {
    return this.repo.find({ where: { taskId }, relations: ['uploadedBy'], order: { createdAt: 'DESC' } });
  }

  async upload(file: Express.Multer.File, userId: string, projectId?: string, taskId?: string) {
    const attachment = this.repo.create({
      originalName: file.originalname,
      filename: file.filename,
      path: `/uploads/files/${file.filename}`,
      mimetype: file.mimetype,
      size: file.size,
      uploadedById: userId,
      projectId,
      taskId,
    });
    return this.repo.save(attachment);
  }

  async remove(id: string) {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    const fsPath = `./uploads/files/${file.filename}`;
    if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath);
    await this.repo.remove(file);
    return { message: 'File deleted' };
  }
}
