import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-log.entity';
import { TelegramService } from '../telegram/telegram.service';

const PM_ROLES = new Set(['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm']);

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private repo: Repository<Comment>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private activityLog: ActivityLogService,
    private telegramService: TelegramService,
  ) {}

  /** Доступ к комментариям задачи имеют только: PM-роли, исполнитель,
   *  создатель, участник проекта, менеджер проекта. */
  private async assertCanAccessTask(taskId: string, viewer: { id: string; role?: string }): Promise<void> {
    if (viewer.role && PM_ROLES.has(viewer.role)) return;
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['project', 'project.members', 'assignees'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assigneeId === viewer.id) return;
    if (task.createdById === viewer.id) return;
    if ((task as any).assignees?.some((a: any) => a.userId === viewer.id)) return;
    if (task.project?.managerId === viewer.id) return;
    if ((task.project?.members || []).some((m: any) => m.id === viewer.id)) return;
    throw new ForbiddenException('Нет доступа к этой задаче');
  }

  async findByTask(taskId: string, viewer?: { id: string; role?: string }) {
    if (viewer) await this.assertCanAccessTask(taskId, viewer);
    return this.repo.find({
      where: { taskId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(taskId: string, message: string, userId: string, userRole?: string) {
    await this.assertCanAccessTask(taskId, { id: userId, role: userRole });
    // Валидация: пустые комментарии не сохраняем — иначе на UI
    // получаем пустую серую плашку без текста.
    const cleanMessage = (message || '').trim();
    if (!cleanMessage) {
      throw new BadRequestException('Комментарий не может быть пустым');
    }

    // Load task with assignee, project, and author info
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['assignee', 'project'],
    });

    const comment = this.repo.create({ taskId, message: cleanMessage, authorId: userId });
    const saved = await this.repo.save(comment);

    if (task?.assigneeId && task.assigneeId !== userId) {
      // In-app notification
      await this.notificationsService.create({
        userId: task.assigneeId,
        type: NotificationType.TASK_COMMENT,
        title: 'Новый комментарий',
        message: `Новый комментарий к задаче "${task.title}"`,
        link: `/tasks/${taskId}`,
      });

      // Email + Telegram notification to task assignee
      if (task.assignee?.email) {
        const author = await this.userRepo.findOne({ where: { id: userId } });
        const authorName = author?.name || 'Сотрудник';
        await this.mailService.sendCommentNotification(
          task.assignee.email,
          task.assignee.name,
          message,
          task.title,
          task.project?.name || '',
          taskId,
          authorName,
        );
        await this.telegramService.sendToUser(
          task.assigneeId,
          `💬 <b>Новый комментарий к задаче</b>\n\n` +
          `📋 ${task.title}` +
          (task.project?.name ? `\n📁 ${task.project.name}` : '') +
          `\n👤 Автор: ${authorName}\n\n` +
          `<i>${message}</i>\n\n` +
          `👉 ${this.telegramService.appUrl}/tasks/${taskId}`,
        );
      }
    }

    const author = await this.userRepo.findOne({ where: { id: userId } });
    await this.activityLog.log({
      userId,
      userName: author?.name,
      action: ActivityAction.COMMENT_CREATE,
      entity: 'task',
      entityId: taskId,
      entityName: task?.title,
      details: { commentId: saved.id },
    });

    return this.repo.findOne({ where: { id: saved.id }, relations: ['author'] });
  }

  async update(id: string, message: string, userId: string) {
    const cleanMessage = (message || '').trim();
    if (!cleanMessage) {
      throw new BadRequestException('Комментарий не может быть пустым');
    }
    const comment = await this.repo.findOne({ where: { id }, relations: ['author'] });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId) throw new ForbiddenException('Not your comment');
    comment.message = cleanMessage;
    comment.isEdited = true;
    const saved = await this.repo.save(comment);

    await this.activityLog.log({
      userId,
      userName: comment.author?.name,
      action: ActivityAction.COMMENT_UPDATE,
      entity: 'comment',
      entityId: id,
      details: { taskId: comment.taskId },
    });

    return saved;
  }

  async remove(id: string, userId: string, userRole: string) {
    const comment = await this.repo.findOne({ where: { id }, relations: ['author'] });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && userRole !== 'admin') {
      throw new ForbiddenException('Not allowed');
    }
    await this.activityLog.log({
      userId,
      userName: comment.author?.name,
      action: ActivityAction.COMMENT_DELETE,
      entity: 'comment',
      entityId: id,
      details: { taskId: comment.taskId },
    });
    await this.repo.remove(comment);
    return { message: 'Comment deleted' };
  }
}
