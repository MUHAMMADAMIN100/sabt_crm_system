import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { Task } from '../tasks/task.entity';

const PM_ROLES = ['admin', 'founder', 'project_manager'];

@Injectable()
export class TaskChecklistsService {
  constructor(
    @InjectRepository(TaskChecklistItem)
    private repo: Repository<TaskChecklistItem>,
    @InjectRepository(Task)
    private taskRepo: Repository<Task>,
  ) {}

  private async assertCanModifyTask(taskId: string, userId: string, role: string) {
    if (PM_ROLES.includes(role)) return;
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assigneeId !== userId && task.createdById !== userId) {
      throw new ForbiddenException('Нельзя изменять чек-лист чужой задачи');
    }
  }

  findByTask(taskId: string): Promise<TaskChecklistItem[]> {
    return this.repo.find({
      where: { taskId },
      relations: ['doneBy'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(taskId: string, text: string, userId: string, role: string): Promise<TaskChecklistItem> {
    await this.assertCanModifyTask(taskId, userId, role);
    return this.repo.save(this.repo.create({ taskId, text }));
  }

  async toggle(id: string, userId: string, role: string): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role);
    item.isDone = !item.isDone;
    item.doneById = item.isDone ? userId : null;
    item.doneAt = item.isDone ? new Date() : null;
    return this.repo.save(item);
  }

  async update(id: string, text: string, userId: string, role: string): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role);
    item.text = text;
    return this.repo.save(item);
  }

  async remove(id: string, userId: string, role: string): Promise<{ message: string }> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role);
    await this.repo.remove(item);
    return { message: 'Deleted' };
  }

  async getProgress(taskId: string): Promise<{ total: number; done: number }> {
    const items = await this.repo.find({ where: { taskId } });
    return { total: items.length, done: items.filter(i => i.isDone).length };
  }
}
