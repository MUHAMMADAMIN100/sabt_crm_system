import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileAttachment } from './file.entity';
import * as fs from 'fs/promises';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileAttachment) private repo: Repository<FileAttachment>,
    private activityLog: ActivityLogService,
  ) {}

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
    const saved = await this.repo.save(attachment);

    await this.activityLog.log({
      userId,
      action: ActivityAction.FILE_UPLOAD,
      entity: projectId ? 'project' : 'task',
      entityId: projectId || taskId,
      entityName: file.originalname,
      details: { filename: file.filename, size: file.size, mimetype: file.mimetype },
    });

    return saved;
  }

  async remove(id: string, userId?: string, userRole?: string) {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    if (userId && file.uploadedById !== userId && userRole !== 'admin') {
      throw new ForbiddenException('Not allowed to delete this file');
    }

    await this.activityLog.log({
      userId: file.uploadedById,
      action: ActivityAction.FILE_DELETE,
      entity: file.projectId ? 'project' : 'task',
      entityId: file.projectId || file.taskId,
      entityName: file.originalName,
      details: { filename: file.filename },
    });

    const fsPath = `./uploads/files/${file.filename}`;
    try {
      await fs.unlink(fsPath);
    } catch (err: any) {
      // ENOENT — файла уже нет на диске, это не ошибка
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete file ${fsPath}: ${err?.message}`);
      }
    }
    await this.repo.remove(file);
    return { message: 'File deleted' };
  }
}
