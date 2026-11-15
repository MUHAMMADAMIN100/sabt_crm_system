import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskChecklistItem } from './task-checklist-item.entity';
import { Task } from '../tasks/task.entity';
import { TaskViewer, assertTaskReadable, canWorkOnTask, loadTaskAccess } from '../tasks/task-access';

@Injectable()
export class TaskChecklistsService {
  constructor(
    @InjectRepository(TaskChecklistItem)
    private repo: Repository<TaskChecklistItem>,
    @InjectRepository(Task)
    private taskRepo: Repository<Task>,
  ) {}

  /** Править чек-лист: PM-роли (в т.ч. dev_director и pm_dev, основной или
   *  второй ролью — в своей сфере), исполнитель, со-исполнитель, автор
   *  (15.11.2026: раньше PM-список был без руководителей разработки). */
  private async assertCanModifyTask(taskId: string, userId: string, role: string, secondaryRole?: string | null) {
    const viewer: TaskViewer = { id: userId, role, secondaryRole };
    const row = await loadTaskAccess(this.taskRepo.manager, taskId, userId);
    if (!row) throw new NotFoundException('Task not found');
    if (!canWorkOnTask(row, viewer)) {
      throw new ForbiddenException('Нельзя изменять чек-лист чужой задачи');
    }
  }

  /** Чек-лист задачи. С viewer — та же проверка доступа, что у карточки
   *  задачи (15.11.2026: раньше отдавали чек-лист любой задачи по id). */
  async findByTask(taskId: string, viewer?: TaskViewer): Promise<TaskChecklistItem[]> {
    if (viewer) await assertTaskReadable(this.taskRepo.manager, taskId, viewer);
    return this.repo.find({
      where: { taskId },
      relations: ['doneBy'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(taskId: string, text: string, userId: string, role: string, secondaryRole?: string | null): Promise<TaskChecklistItem> {
    await this.assertCanModifyTask(taskId, userId, role, secondaryRole);
    return this.repo.save(this.repo.create({ taskId, text }));
  }

  async toggle(id: string, userId: string, role: string, secondaryRole?: string | null): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role, secondaryRole);
    item.isDone = !item.isDone;
    item.doneById = item.isDone ? userId : null;
    item.doneAt = item.isDone ? new Date() : null;
    return this.repo.save(item);
  }

  async update(id: string, text: string, userId: string, role: string, secondaryRole?: string | null): Promise<TaskChecklistItem> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role, secondaryRole);
    item.text = text;
    return this.repo.save(item);
  }

  async remove(id: string, userId: string, role: string, secondaryRole?: string | null): Promise<{ message: string }> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    await this.assertCanModifyTask(item.taskId, userId, role, secondaryRole);
    await this.repo.remove(item);
    return { message: 'Deleted' };
  }

  async getProgress(taskId: string): Promise<{ total: number; done: number }> {
    const items = await this.repo.find({ where: { taskId } });
    return { total: items.length, done: items.filter(i => i.isDone).length };
  }
}
