import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus, TaskPriority } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { ProjectsService } from '../projects/projects.service';
import { UserRole, User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private projectsService: ProjectsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
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

    const creator = await this.userRepo.findOne({ where: { id: userId } });

    if (dto.assigneeId && dto.assigneeId !== userId) {
      await this.notificationsService.create({
        userId: dto.assigneeId,
        type: NotificationType.NEW_TASK,
        title: 'Новая задача',
        message: `Вам назначена задача: "${saved.title}"`,
        link: `/tasks/${saved.id}`,
      });

      // Email + Telegram notification
      const assignee = await this.userRepo.findOne({ where: { id: dto.assigneeId } });
      if (assignee?.email) {
        const full = await this.findOne(saved.id);
        const deadline = saved.deadline ? new Date(saved.deadline).toLocaleDateString('ru-RU') : undefined;
        await this.mailService.sendTaskAssigned(
          assignee.email,
          assignee.name,
          saved.title,
          saved.id,
          full.project?.name,
          deadline,
          saved.priority,
          saved.description || undefined,
        );
        const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный', critical: 'Критический' };
        await this.telegramService.sendToUser(
          dto.assigneeId,
          `✅ <b>Вам назначена задача</b>\n\n` +
          `📋 ${saved.title}` +
          (full.project?.name ? `\n📁 ${full.project.name}` : '') +
          (saved.priority ? `\n🔥 Приоритет: ${priorityLabels[saved.priority] || saved.priority}` : '') +
          (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
          `\n\n👉 ${this.telegramService.appUrl}/tasks/${saved.id}`,
        );
      }
    }

    await this.activityLog.log({
      userId,
      userName: creator?.name,
      action: ActivityAction.TASK_CREATE,
      entity: 'task',
      entityId: saved.id,
      entityName: saved.title,
      details: { projectId: dto.projectId, priority: dto.priority, assigneeId: dto.assigneeId },
    });

    await this.projectsService.updateProgress(dto.projectId);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateTaskDto, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);

    if (user.role === UserRole.EMPLOYEE && task.assigneeId !== user.id) {
      throw new ForbiddenException('Not allowed');
    }

    const oldStatus = task.status;
    const oldAssigneeId = task.assigneeId;
    await this.repo.update(id, dto);

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
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_STATUS,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: { from: oldStatus, to: dto.status },
      });
    }

    // Notify on new assignee
    if (dto.assigneeId && dto.assigneeId !== oldAssigneeId) {
      await this.notificationsService.create({
        userId: dto.assigneeId,
        type: NotificationType.NEW_TASK,
        title: 'Вам назначена задача',
        message: `Задача "${task.title}" теперь назначена вам`,
        link: `/tasks/${id}`,
      });

      // Email + Telegram notification
      const assignee = await this.userRepo.findOne({ where: { id: dto.assigneeId } });
      if (assignee?.email) {
        const full = await this.findOne(id);
        const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString('ru-RU') : undefined;
        const priority = dto.priority || task.priority;
        await this.mailService.sendTaskAssigned(
          assignee.email,
          assignee.name,
          task.title,
          id,
          full.project?.name,
          deadline,
          priority,
          task.description || undefined,
        );
        const priorityLabels: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', urgent: 'Срочный', critical: 'Критический' };
        await this.telegramService.sendToUser(
          dto.assigneeId,
          `✅ <b>Вам назначена задача</b>\n\n` +
          `📋 ${task.title}` +
          (full.project?.name ? `\n📁 ${full.project.name}` : '') +
          (priority ? `\n🔥 Приоритет: ${priorityLabels[priority] || priority}` : '') +
          (deadline ? `\n📅 Дедлайн: ${deadline}` : '') +
          `\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
        );
      }
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_ASSIGN,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: { assigneeId: dto.assigneeId },
      });
    }

    // Log generic update if neither status nor assignee changed
    if (!dto.status && !dto.assigneeId) {
      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_UPDATE,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: dto,
      });
    }

    await this.projectsService.updateProgress(task.projectId);
    return this.findOne(id);
  }

  async remove(id: string) {
    const task = await this.findOne(id);
    const projectId = task.projectId;
    await this.activityLog.log({
      action: ActivityAction.TASK_DELETE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
    });
    await this.repo.remove(task);
    await this.projectsService.updateProgress(projectId);
    return { message: 'Task deleted' };
  }

  async removeWithAuth(id: string, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);
    if (user.role === UserRole.EMPLOYEE && task.assigneeId !== user.id && task.createdById !== user.id) {
      throw new ForbiddenException('Not allowed');
    }
    const projectId = task.projectId;
    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.TASK_DELETE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
    });
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
