import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskChecklistItem } from './task-checklist-item.entity';

@Injectable()
export class TaskChecklistsService {
  constructor(
    @InjectRepository(TaskChecklistItem)
    private repo: Repository<TaskChecklistItem>,
  ) {}

  findByTask(taskId: string): Promise<TaskChecklistItem[]> {
    return this.repo.find({
      where: { taskId },
      relations: ['doneBy'],
      order: { createdAt: 'ASC' },
    });
  }

  create(taskId: string, text: string): Promise<TaskChecklistItem> {
    return this.repo.save(this.repo.create({ taskId, text }));
  }

  async toggle(id: string, userId: string): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    item.isDone = !item.isDone;
    item.doneById = item.isDone ? userId : null;
    item.doneAt = item.isDone ? new Date() : null;
    return this.repo.save(item);
  }

  async update(id: string, text: string): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    item.text = text;
    return this.repo.save(item);
  }

  async remove(id: string, userId: string, isManager: boolean): Promise<{ message: string }> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    if (!isManager) throw new ForbiddenException('Only managers can delete checklist items');
    await this.repo.remove(item);
    return { message: 'Deleted' };
  }

  async getProgress(taskId: string): Promise<{ total: number; done: number }> {
    const items = await this.repo.find({ where: { taskId } });
    return { total: items.length, done: items.filter(i => i.isDone).length };
  }
}
