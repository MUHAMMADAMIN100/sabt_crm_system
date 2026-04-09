import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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
import { AppGateway } from '../gateway/app.gateway';
import { TaskResultsService } from '../task-results/task-results.service';

const PM_ROLES = [UserRole.ADMIN, UserRole.FOUNDER, UserRole.PROJECT_MANAGER];
const WORKER_ROLES = [UserRole.SMM_SPECIALIST, UserRole.DESIGNER, UserRole.MARKETER, UserRole.TARGETOLOGIST, UserRole.SALES_MANAGER, UserRole.EMPLOYEE];

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
    private gateway: AppGateway,
    private taskResultsService: TaskResultsService,
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
    this.gateway.broadcast('tasks:changed', { projectId: dto.projectId });
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateTaskDto, user: { id: string; role: string; name?: string }) {
    const task = await this.findOne(id);

    // Workers can only update their own tasks
    if (WORKER_ROLES.includes(user.role as UserRole) && task.assigneeId !== user.id) {
      throw new ForbiddenException('Not allowed');
    }

    // Workers cannot directly set status to DONE — must go through review
    if (WORKER_ROLES.includes(user.role as UserRole) && dto.status === TaskStatus.DONE) {
      throw new ForbiddenException('Only a project manager can confirm task completion');
    }

    // Require at least one result before sending to review (workers only — PM/admin can drag freely)
    if (dto.status === TaskStatus.REVIEW && WORKER_ROLES.includes(user.role as UserRole)) {
      const resultCount = await this.taskResultsService.countByTask(id);
      if (resultCount === 0) {
        throw new BadRequestException('Загрузите результат работы перед отправкой на проверку');
      }
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
    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });
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
    this.gateway.broadcast('tasks:changed', { projectId });
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
    this.gateway.broadcast('tasks:changed', { projectId });
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

  async approveTask(id: string, user: { id: string; role: string; name?: string }) {
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only project managers can approve tasks');
    }
    const task = await this.findOne(id);
    if (task.status !== TaskStatus.REVIEW) {
      throw new BadRequestException('Задача должна быть на проверке');
    }

    await this.repo.update(id, {
      status: TaskStatus.DONE,
      reviewedById: user.id,
      reviewedAt: new Date(),
    });

    if (task.assigneeId) {
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_COMPLETED,
        title: 'Задача подтверждена',
        message: `Задача "${task.title}" принята и закрыта`,
        link: `/tasks/${id}`,
      });
    }

    await this.activityLog.log({
      userId: user.id,
      userName: user.name,
      action: ActivityAction.TASK_REVIEW_APPROVE,
      entity: 'task',
      entityId: id,
      entityName: task.title,
    });

    await this.projectsService.updateProgress(task.projectId);
    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });
    return this.findOne(id);
  }

  async returnTask(id: string, user: { id: string; role: string; name?: string }, reason: string) {
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only project managers can return tasks');
    }
    const task = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'project'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== TaskStatus.REVIEW) {
      throw new BadRequestException('Задача должна быть на проверке');
    }

    await this.repo.update(id, {
      status: TaskStatus.RETURNED,
      returnReason: reason,
    });

    try {
      if (task.assigneeId) {
        await this.notificationsService.create({
          userId: task.assigneeId,
          type: NotificationType.TASK_RETURNED,
          title: 'Задача возвращена в работу',
          message: `"${task.title}": ${reason}`,
          link: `/tasks/${id}`,
          data: { reason },
        });

        await this.telegramService.sendToUser(
          task.assigneeId,
          `🔁 <b>Задача возвращена в работу</b>\n\n📋 ${task.title}\n💬 ${reason}\n\n👉 ${this.telegramService.appUrl}/tasks/${id}`,
        );
      }

      await this.activityLog.log({
        userId: user.id,
        userName: user.name,
        action: ActivityAction.TASK_REVIEW_RETURN,
        entity: 'task',
        entityId: id,
        entityName: task.title,
        details: { reason },
      });
    } catch (e) {
      // Don't fail the return if notifications crash
    }

    await this.projectsService.updateProgress(task.projectId);
    this.gateway.broadcast('tasks:changed', { projectId: task.projectId });

    return { id: task.id, status: task.status, returnReason: task.returnReason, title: task.title };
  }

  getStats(projectId?: string) {
    const qb = this.repo.createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status');
    if (projectId) qb.where('t.projectId = :projectId', { projectId });
    return qb.getRawMany();
  }

  async bulkAction(
    ids: string[],
    action: 'status' | 'delete' | 'assign',
    value: string | undefined,
    user: { id: string; role: string; name?: string },
  ): Promise<{ affected: number }> {
    if (!ids?.length) return { affected: 0 };
    if (!PM_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Массовые действия доступны только менеджерам');
    }

    if (action === 'delete') {
      const tasks = await this.repo.findByIds(ids);
      await this.repo.remove(tasks);
      return { affected: tasks.length };
    }

    if (action === 'status' && value) {
      await this.repo.createQueryBuilder()
        .update(Task)
        .set({ status: value as TaskStatus })
        .whereInIds(ids)
        .execute();
      return { affected: ids.length };
    }

    if (action === 'assign' && value) {
      await this.repo.createQueryBuilder()
        .update(Task)
        .set({ assigneeId: value })
        .whereInIds(ids)
        .execute();
      return { affected: ids.length };
    }

    return { affected: 0 };
  }
}
