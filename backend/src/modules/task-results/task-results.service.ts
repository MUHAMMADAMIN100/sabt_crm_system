import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskResult } from './task-result.entity';
import { CreateTaskResultDto } from './dto/create-task-result.dto';

@Injectable()
export class TaskResultsService {
  constructor(
    @InjectRepository(TaskResult) private repo: Repository<TaskResult>,
  ) {}

  async create(taskId: string, submittedById: string, dto: CreateTaskResultDto): Promise<TaskResult> {
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

  async remove(id: string, userId: string): Promise<{ message: string }> {
    const result = await this.repo.findOne({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');
    if (result.submittedById !== userId) throw new ForbiddenException('Not allowed');
    await this.repo.remove(result);
    return { message: 'Deleted' };
  }
}
