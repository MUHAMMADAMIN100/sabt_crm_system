import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './notification.entity';

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
  constructor(@InjectRepository(Notification) private repo: Repository<Notification>) {}

  async create(dto: CreateNotificationDto) {
    const notif = this.repo.create(dto);
    return this.repo.save(notif);
  }

  findByUser(userId: string, unreadOnly = false) {
    const where: any = { userId };
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

  async notifyDeadlines() {
    // Called by scheduler — notify tasks due in 24h
    // This would be implemented with TasksService injection
  }
}
