import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { Notification, NotificationType } from './notification.entity';
import { User } from '../users/user.entity';
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
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  /** FCM включён только при наличии ключа (env или файл). Без ключа система
   *  работает как раньше — просто без мобильных пушей, один warn в лог. */
  private fcmEnabled = false;

  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: AppGateway,
  ) {}

  onModuleInit() {
    try {
      if (admin.apps.length > 0) { this.fcmEnabled = true; return; }
      const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (envJson) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(envJson)) });
        this.fcmEnabled = true;
        this.logger.log('FCM: Firebase Admin инициализирован из FIREBASE_SERVICE_ACCOUNT_JSON');
        return;
      }
      const saPath = path.join(process.cwd(), 'firebase-service-account.json');
      if (fs.existsSync(saPath)) {
        admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) });
        this.fcmEnabled = true;
        this.logger.log('FCM: Firebase Admin инициализирован из firebase-service-account.json');
        return;
      }
      // Намеренно БЕЗ фолбэка на Application Default Credentials: на Railway
      // их нет — «успешная» инициализация без ключа роняла бы каждый пуш.
      this.logger.warn('FCM: ключ не найден (FIREBASE_SERVICE_ACCOUNT_JSON) — мобильные пуши отключены');
    } catch (e: any) {
      this.logger.warn(`FCM: инициализация не удалась, пуши отключены: ${e?.message || e}`);
    }
  }

  /** Отправить нативный пуш на все устройства пользователя. Невалидные
   *  токены (приложение удалено/кэш сброшен) вычищаются из базы. */
  private async sendPush(userId: string, title: string, body: string, link?: string) {
    if (!this.fcmEnabled) return;
    // Колонка select:false — читаем явно.
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'fcmTokens'] as any });
    const tokens = user?.fcmTokens || [];
    if (!tokens.length) return;

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { link: link || '' },
    });
    if (res.failureCount > 0) {
      // Убираем ТОЛЬКО заведомо мёртвые токены — канонический код
      // registration-token-not-registered (invalid-argument бывает и при
      // кривом payload'е, живой токен по нему удалять нельзя).
      const dead = new Set<string>();
      res.responses.forEach((r, i) => {
        const code = (r.error as any)?.code || '';
        if (code === 'messaging/registration-token-not-registered') dead.add(tokens[i]);
        else if (r.error) this.logger.warn(`FCM: не доставлено (${code}): ${r.error.message}`);
      });
      if (dead.size > 0) {
        const rest = tokens.filter(t => !dead.has(t));
        await this.userRepo.update(userId, { fcmTokens: rest.length ? rest : null });
        this.logger.log(`FCM: удалено мёртвых токенов у ${userId}: ${dead.size}`);
      }
    }
  }

  async create(dto: CreateNotificationDto) {
    const notif = this.repo.create(dto);
    const saved = await this.repo.save(notif);
    // Push real-time notification to connected client
    this.gateway.notifyUser(dto.userId, 'notification', saved);
    // Нативный пуш на телефон (мобильное приложение) — fire-and-forget,
    // основной поток уведомлений не блокируем и не роняем.
    this.sendPush(dto.userId, dto.title, dto.message, dto.link)
      .catch(e => this.logger.warn(`FCM: отправка пуша не удалась: ${e?.message || e}`));
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
