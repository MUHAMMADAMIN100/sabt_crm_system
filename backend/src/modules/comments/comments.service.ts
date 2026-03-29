import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

  findByTask(taskId: string) {
    return this.repo.find({
      where: { taskId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(taskId: string, message: string, userId: string) {
    // Load task with assignee, project, and author info
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['assignee', 'project'],
    });

    const comment = this.repo.create({ taskId, message, authorId: userId });
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
    const comment = await this.repo.findOne({ where: { id }, relations: ['author'] });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId) throw new ForbiddenException('Not your comment');
    comment.message = message;
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
