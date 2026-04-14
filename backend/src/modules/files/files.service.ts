import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileAttachment } from './file.entity';
import { Task } from '../tasks/task.entity';
import { Project } from '../projects/project.entity';
import * as fs from 'fs/promises';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';

const PM_ROLES = ['admin', 'founder', 'project_manager', 'head_smm'];

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileAttachment) private repo: Repository<FileAttachment>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private activityLog: ActivityLogService,
  ) {}

  findByProject(projectId: string) {
    return this.repo.find({ where: { projectId }, relations: ['uploadedBy'], order: { createdAt: 'DESC' } });
  }

  findByTask(taskId: string) {
    return this.repo.find({ where: { taskId }, relations: ['uploadedBy'], order: { createdAt: 'DESC' } });
  }

  async upload(file: Express.Multer.File, userId: string, role: string, projectId?: string, taskId?: string) {
    if (!PM_ROLES.includes(role)) {
      if (taskId) {
        const task = await this.taskRepo.findOne({ where: { id: taskId } });
        if (!task) throw new NotFoundException('Task not found');
        if (task.assigneeId !== userId && task.createdById !== userId) {
          throw new ForbiddenException('Нельзя прикреплять файлы к чужой задаче');
        }
      } else if (projectId) {
        const project = await this.projectRepo.findOne({ where: { id: projectId }, relations: ['members'] });
        if (!project) throw new NotFoundException('Project not found');
        const isMember = project.members?.some(m => m.id === userId);
        if (!isMember && project.managerId !== userId) {
          throw new ForbiddenException('Нельзя прикреплять файлы к проекту, в котором вы не участвуете');
        }
      }
    }
    // Multer (busboy) decodes the multipart filename as latin1 by default,
    // so UTF-8 names (Cyrillic, emoji, etc.) arrive mangled. Re-decode.
    const fixedName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const attachment = this.repo.create({
      originalName: fixedName,
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
      entityName: fixedName,
      details: { filename: file.filename, size: file.size, mimetype: file.mimetype },
    });

    return saved;
  }

  async remove(id: string, userId?: string, userRole?: string) {
    const file = await this.repo.findOne({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    if (userId && file.uploadedById !== userId && !['admin', 'founder'].includes(userRole || '')) {
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
