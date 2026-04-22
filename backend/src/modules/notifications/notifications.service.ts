import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';
import { AppGateway } from '../gateway/app.gateway';

interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    private gateway: AppGateway,
  ) {}

  async create(dto: CreateNotificationDto) {
    const notif = this.repo.create(dto);
    const saved = await this.repo.save(notif);
    // Push real-time notification to connected client
    this.gateway.notifyUser(dto.userId, 'notification', saved);
    return saved;
  }

  /** Wave 6: создаёт уведомление только если за последние `dedupHours`
   *  не было такого же (по type + userId + data.alertKey).
   *  Используется для риск-алертов, чтобы не спамить ежедневно одинаковыми
   *  сообщениями. Возвращает true если создали, false если задедуплицировали. */
  async createIfNotRecent(
    dto: CreateNotificationDto & { data: { alertKey: string } },
    dedupHours = 24,
  ): Promise<boolean> {
    const since = new Date(Date.now() - dedupHours * 60 * 60 * 1000);
    const exists = await this.repo
      .createQueryBuilder('n')
      .where('n.userId = :uid', { uid: dto.userId })
      .andWhere('n.type = :type', { type: dto.type })
      .andWhere('n.createdAt > :since', { since })
      .andWhere(`n.data->>'alertKey' = :key`, { key: dto.data.alertKey })
      .getCount();
    if (exists > 0) return false;
    await this.create(dto);
    return true;
  }

  findByUser(userId: string, unreadOnly = false) {
    const where: { userId: string; isRead?: boolean } = { userId };
    if (unreadOnly) where.isRead = false;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }

  async markRead(id: string, userId: string) {
    await this.repo.update({ id, userId }, { isRead: true });
    return { message: 'Marked as read' };
  }

  async markAllRead(userId: string) {
    await this.repo.update({ userId, isRead: false }, { isRead: true });
    return { message: 'All marked as read' };
  }

  async remove(id: string, userId: string) {
    await this.repo.delete({ id, userId });
    return { message: 'Deleted' };
  }

  countUnread(userId: string) {
    return this.repo.count({ where: { userId, isRead: false } });
  }

  /** Delete all notifications whose link points to a given path prefix
   *  (e.g. `/tasks/abc-123`). Used as cleanup when an entity is deleted. */
  async deleteByLink(linkPath: string) {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('link = :link', { link: linkPath })
      .execute();
  }

  async notifyDeadlines() {
    // Called by scheduler — notify tasks due in 24h
    // This would be implemented with TasksService injection
  }
}
