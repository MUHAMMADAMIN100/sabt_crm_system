import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus, TaskPriority } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { ProjectsService } from '../projects/projects.service';
import { UserRole } from '../users/user.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    private notificationsService: NotificationsService,
    private projectsService: ProjectsService,
  ) {}

  findAll(filters: {
    projectId?: string;
    assigneeId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    search?: string;
    deadlineBefore?: string;
  }) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.createdBy', 'createdBy')
      .leftJoinAndSelect('t.project', 'project');

    if (filters.projectId) qb.andWhere('t.projectId = :projectId', { projectId: filters.projectId });
    if (filters.assigneeId) qb.andWhere('t.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    if (filters.status) qb.andWhere('t.status = :status', { status: filters.status });
    if (filters.priority) qb.andWhere('t.priority = :priority', { priority: filters.priority });
    if (filters.search) qb.andWhere('t.title ILIKE :search', { search: `%${filters.search}%` });
    if (filters.deadlineBefore) qb.andWhere('t.deadline <= :deadline', { deadline: filters.deadlineBefore });

    return qb.orderBy('t.createdAt', 'DESC').getMany();
  }

  async findOne(id: string) {
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'createdBy', 'project', 'comments', 'comments.author', 'timeLogs', 'files'],
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(dto: CreateTaskDto, userId: string) {
    const task = this.repo.create({ ...dto, createdById: userId });
    const saved = await this.repo.save(task);

    if (dto.assigneeId && dto.assigneeId !== userId) {
      await this.notificationsService.create({
        userId: dto.assigneeId,
        type: NotificationType.NEW_TASK,
        title: 'Новая задача',
        message: `Вам назначена задача: "${saved.title}"`,
        link: `/tasks/${saved.id}`,
      });
    }

    await this.projectsService.updateProgress(dto.projectId);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateTaskDto, user: any) {
    const task = await this.findOne(id);

    if (user.role === UserRole.EMPLOYEE && task.assigneeId !== user.id) {
      throw new ForbiddenException('Not allowed');
    }

    const oldStatus = task.status;
    await this.repo.update(id, dto as any);

    // Notify on status change
    if (dto.status && dto.status !== oldStatus) {
      const notifyId = task.createdById !== user.id ? task.createdById : task.assigneeId;
      if (notifyId) {
        await this.notificationsService.create({
          userId: notifyId,
          type: NotificationType.STATUS_CHANGE,
          title: 'Статус задачи изменён',
          message: `Задача "${task.title}" изменила статус на "${dto.status}"`,
          link: `/tasks/${id}`,
        });
      }
    }

    // Notify on new assignee
    if (dto.assigneeId && dto.assigneeId !== task.assigneeId) {
      await this.notificationsService.create({
        userId: dto.assigneeId,
        type: NotificationType.NEW_TASK,
        title: 'Вам назначена задача',
        message: `Задача "${task.title}" теперь назначена вам`,
        link: `/tasks/${id}`,
      });
    }

    await this.projectsService.updateProgress(task.projectId);
    return this.findOne(id);
  }

  async remove(id: string) {
    const task = await this.findOne(id);
    const projectId = task.projectId;
    await this.repo.remove(task);
    await this.projectsService.updateProgress(projectId);
    return { message: 'Task deleted' };
  }

  async removeWithAuth(id: string, user: any) {
    const task = await this.findOne(id);
    if (user.role === UserRole.EMPLOYEE && task.assigneeId !== user.id && task.createdById !== user.id) {
      throw new ForbiddenException('Not allowed');
    }
    const projectId = task.projectId;
    await this.repo.remove(task);
    await this.projectsService.updateProgress(projectId);
    return { message: 'Task deleted' };
  }

  getMyTasks(userId: string) {
    return this.repo.find({
      where: { assigneeId: userId },
      relations: ['project'],
      order: { deadline: 'ASC' },
    });
  }

  getOverdueTasks() {
    return this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.project', 'project')
      .where('t.deadline < NOW()')
      .andWhere('t.status NOT IN (:...statuses)', { statuses: [TaskStatus.DONE, TaskStatus.CANCELLED] })
      .getMany();
  }

  getStats(projectId?: string) {
    const qb = this.repo.createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status');
    if (projectId) qb.where('t.projectId = :projectId', { projectId });
    return qb.getRawMany();
  }
}
