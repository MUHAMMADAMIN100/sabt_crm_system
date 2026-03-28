import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { MailService } from '../mail/mail.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment) private repo: Repository<Comment>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notificationsService: NotificationsService,
    private mailService: MailService,
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

      // Email notification to task assignee
      if (task.assignee?.email) {
        const author = await this.userRepo.findOne({ where: { id: userId } });
        await this.mailService.sendCommentNotification(
          task.assignee.email,
          task.assignee.name,
          message,
          task.title,
          task.project?.name || '',
          taskId,
          author?.name || 'Сотрудник',
        );
      }
    }

    return this.repo.findOne({ where: { id: saved.id }, relations: ['author'] });
  }

  async update(id: string, message: string, userId: string) {
    const comment = await this.repo.findOne({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId) throw new ForbiddenException('Not your comment');
    comment.message = message;
    comment.isEdited = true;
    return this.repo.save(comment);
  }

  async remove(id: string, userId: string, userRole: string) {
    const comment = await this.repo.findOne({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && userRole !== 'admin') {
      throw new ForbiddenException('Not allowed');
    }
    await this.repo.remove(comment);
    return { message: 'Comment deleted' };
  }
}
