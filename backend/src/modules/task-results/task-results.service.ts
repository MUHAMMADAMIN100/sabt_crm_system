import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskResult } from './task-result.entity';
import { Task } from '../tasks/task.entity';
import { CreateTaskResultDto } from './dto/create-task-result.dto';
import { AppGateway } from '../gateway/app.gateway';
import { TaskViewer, assertTaskReadable, canWorkOnTask, isPmForTask, loadTaskAccess } from '../tasks/task-access';

// Руководители (в т.ч. руководитель разработки и pm_dev — основной или второй
// ролью, в своей сфере) — приёмщики работ: могут приложить/снять результат.
// Общий список и правило — tasks/task-access.ts (15.11.2026).

@Injectable()
export class TaskResultsService {
  constructor(
    @InjectRepository(TaskResult) private repo: Repository<TaskResult>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private gateway: AppGateway,
  ) {}

  async create(
    taskId: string, submittedById: string, role: string, dto: CreateTaskResultDto, secondaryRole?: string | null,
  ): Promise<TaskResult> {
    const viewer: TaskViewer = { id: submittedById, role, secondaryRole };
    const row = await loadTaskAccess(this.taskRepo.manager, taskId, submittedById);
    if (!row) throw new NotFoundException('Task not found');
    // Исполнитель, со-исполнитель, автор или руководитель своей сферы.
    if (!canWorkOnTask(row, viewer)) {
      throw new ForbiddenException('Нельзя прикреплять результат к чужой задаче');
    }
    const result = this.repo.create({ taskId, submittedById, ...dto });
    const saved = await this.repo.save(result);
    // Реалтайм: руководитель видит приложенный результат сразу, без F5.
    this.gateway.broadcast('task-results:changed', { taskId });
    return saved;
  }

  /** Результаты задачи. С viewer — та же проверка доступа, что у карточки
   *  задачи (15.11.2026: раньше отдавали результаты любой задачи по id). */
  async findByTask(taskId: string, viewer?: TaskViewer): Promise<TaskResult[]> {
    if (viewer) await assertTaskReadable(this.taskRepo.manager, taskId, viewer);
    return this.repo.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
    });
  }

  async countByTask(taskId: string): Promise<number> {
    return this.repo.count({ where: { taskId } });
  }

  async remove(id: string, userId: string, role: string, secondaryRole?: string | null): Promise<{ message: string }> {
    const result = await this.repo.findOne({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');
    if (result.submittedById !== userId) {
      // Чужой результат снимает только руководитель своей сферы.
      const row = await loadTaskAccess(this.taskRepo.manager, result.taskId, userId);
      if (!isPmForTask({ id: userId, role, secondaryRole }, row?.projectType)) {
        throw new ForbiddenException('Not allowed');
      }
    }
    const { taskId } = result;
    await this.repo.remove(result);
    this.gateway.broadcast('task-results:changed', { taskId });
    return { message: 'Deleted' };
  }
}
