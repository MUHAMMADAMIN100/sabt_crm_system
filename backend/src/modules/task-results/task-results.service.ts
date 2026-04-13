import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskResult } from './task-result.entity';
import { Task } from '../tasks/task.entity';
import { CreateTaskResultDto } from './dto/create-task-result.dto';

const PM_ROLES = ['admin', 'founder', 'project_manager'];

@Injectable()
export class TaskResultsService {
  constructor(
    @InjectRepository(TaskResult) private repo: Repository<TaskResult>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
  ) {}

  async create(taskId: string, submittedById: string, role: string, dto: CreateTaskResultDto): Promise<TaskResult> {
    if (!PM_ROLES.includes(role)) {
      const task = await this.taskRepo.findOne({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Task not found');
      if (task.assigneeId !== submittedById && task.createdById !== submittedById) {
        throw new ForbiddenException('Нельзя прикреплять результат к чужой задаче');
      }
    }
    const result = this.repo.create({ taskId, submittedById, ...dto });
    return this.repo.save(result);
  }

  findByTask(taskId: string): Promise<TaskResult[]> {
    return this.repo.find({
      where: { taskId },
      order: { createdAt: 'DESC' },
    });
  }

  async countByTask(taskId: string): Promise<number> {
    return this.repo.count({ where: { taskId } });
  }

  async remove(id: string, userId: string, role: string): Promise<{ message: string }> {
    const result = await this.repo.findOne({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');
    if (!PM_ROLES.includes(role) && result.submittedById !== userId) {
      throw new ForbiddenException('Not allowed');
    }
    await this.repo.remove(result);
    return { message: 'Deleted' };
  }
}
