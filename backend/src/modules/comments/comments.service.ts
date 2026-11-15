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
import { AppGateway } from '../gateway/app.gateway';
import { escapeHtml, truncateTelegramHtml } from '../../common/html-escape';

const PM_ROLES = new Set(['admin', 'founder', 'smm_director']);

/** Кто смотрит/пишет комментарии. secondaryRole — вторая роль: руководитель
 *  SMM второй ролью тоже видит все задачи (15.11.2026). */
type Viewer = { id: string; role?: string; secondaryRole?: string | null };

/** PM-доступ по основной ИЛИ второй роли. */
const isPm = (viewer: { role?: string; secondaryRole?: string | null }) =>
  (!!viewer.role && PM_ROLES.has(viewer.role))
  || (!!viewer.secondaryRole && PM_ROLES.has(viewer.secondaryRole));

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
    private gateway: AppGateway,
  ) {}

  /** Реалтайм-сигнал: комментарии видны всем, кто открыл карточку задачи. */
  private notifyChanged(taskId: string) {
    this.gateway.broadcast('comments:changed', { taskId });
  }

  /** Доступ к комментариям задачи имеют только: PM-роли, исполнитель,
   *  создатель, участник проекта, менеджер проекта. */
  private async assertCanAccessTask(taskId: string, viewer: Viewer): Promise<void> {
    if (isPm(viewer)) return;
    // На Task НЕТ relation 'assignees' — таблица task_assignees отдельная.
    // Если включить её в relations[], TypeORM сразу выкинет 500
    // (EntityMetadataNotFound), что и было причиной internal server error
    // при попытке самокомментария. Мульти-исполнителей проверяем raw SQL.
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['project', 'project.members'],
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.assigneeId === viewer.id) return;
    if (task.createdById === viewer.id) return;
    if (task.project?.managerId === viewer.id) return;
    if ((task.project?.members || []).some((m: any) => m.id === viewer.id)) return;
    const rows: any[] = await this.taskRepo.manager.query(
      `SELECT 1 FROM task_assignees WHERE "taskId" = $1 AND "userId" = $2 LIMIT 1`,
      [taskId, viewer.id],
    ).catch(() => []);
    if (rows && rows.length > 0) return;
    throw new ForbiddenException('Нет доступа к этой задаче');
  }

  async findByTask(taskId: string, viewer?: Viewer) {
    if (viewer) await this.assertCanAccessTask(taskId, viewer);
    return this.repo.find({
      where: { taskId },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async create(taskId: string, message: string, userId: string, userRole?: string, userSecondaryRole?: string | null) {
    await this.assertCanAccessTask(taskId, { id: userId, role: userRole, secondaryRole: userSecondaryRole });
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

    // Побочные эффекты (in-app / email / telegram / activity log) — best-effort.
    // Любая ошибка здесь НЕ должна возвращать 500 пользователю: комментарий
    // уже сохранён в БД, фронт получит свежий объект и отрисует его.
    try {
      if (task?.assigneeId && task.assigneeId !== userId) {
        const author = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
        const authorName = author?.name || 'Сотрудник';

        await this.notificationsService.create({
          userId: task.assigneeId,
          type: NotificationType.TASK_COMMENT,
          title: 'Новый комментарий',
          message: `Новый комментарий к задаче "${task.title}"`,
          link: `/tasks/${taskId}`,
        }).catch(() => {});

        if (task.assignee?.email) {
          // Письмо экранирует значения само (MailService) — передаём как есть.
          await this.mailService.sendCommentNotification(
            task.assignee.email,
            task.assignee.name || 'Сотрудник',
            cleanMessage,
            task.title,
            task.project?.name || '',
            taskId,
            authorName,
          ).catch(() => {});
        }
        // Telegram — не зависит от того, есть ли у исполнителя email
        // (15.11.2026): раньше без почты не уходило и сообщение в Telegram.
        // Текст от людей — через escapeHtml: «<» в комментарии или названии
        // ломал разметку, и Telegram молча терял сообщение.
        await this.telegramService.sendToUser(
          task.assigneeId,
          truncateTelegramHtml(
            `💬 <b>Новый комментарий к задаче</b>\n\n` +
            `📋 ${escapeHtml(task.title)}` +
            (task.project?.name ? `\n📁 ${escapeHtml(task.project.name)}` : '') +
            `\n👤 Автор: ${escapeHtml(authorName)}\n\n` +
            // Длинный комментарий режем отдельно, чтобы ссылка ниже уцелела.
            `<i>${truncateTelegramHtml(escapeHtml(cleanMessage), 3000)}</i>\n\n` +
            `👉 ${this.telegramService.appUrl}/tasks/${taskId}`,
          ),
        ).catch(() => {});
      }

      const author = await this.userRepo.findOne({ where: { id: userId } }).catch(() => null);
      await this.activityLog.log({
        userId,
        userName: author?.name,
        action: ActivityAction.COMMENT_CREATE,
        entity: 'task',
        entityId: taskId,
        entityName: task?.title,
        details: { commentId: saved.id },
      }).catch(() => {});
    } catch {
      // best-effort: ничего не делаем — комментарий уже сохранён.
    }

    this.notifyChanged(taskId);
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

    this.notifyChanged(comment.taskId);
    return saved;
  }

  async remove(id: string, userId: string, userRole: string, userSecondaryRole?: string | null) {
    const comment = await this.repo.findOne({ where: { id }, relations: ['author'] });
    if (!comment) throw new NotFoundException('Comment not found');
    // Чужой комментарий удаляют админ и основатель (15.11.2026: основатель
    // раньше не мог), по основной или второй роли.
    const canModerate = ['admin', 'founder'].includes(userRole)
      || ['admin', 'founder'].includes(userSecondaryRole || '');
    if (comment.authorId !== userId && !canModerate) {
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
    const { taskId } = comment;
    await this.repo.remove(comment);
    this.notifyChanged(taskId);
    return { message: 'Comment deleted' };
  }
}
