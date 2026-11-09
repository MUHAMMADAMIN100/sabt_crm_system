import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from '../tasks/task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { User } from '../users/user.entity';
import { TelegramService } from './telegram.service';

/**
 * Задачи, поставленные голосом в Telegram: контроль просрочки.
 *
 * Сам разбор голосовых с 09.11.2026 живёт в голосовом помощнике
 * (modules/voice-assistant): он делает любые действия CRM, а не только
 * ставит задачи. Здесь осталась проверка раз в час: задачи с меткой
 * VOICE_MARK в описании, у которых прошёл срок, — сообщение автору и
 * исполнителю. Помощник ставит ту же метку, поэтому проверка работает и
 * для новых задач.
 */

/** Метка в описании — та же, что пишет помощник (voice-assistant/tools/tasks.tools.ts). */
const VOICE_MARK = 'Создано голосом в Telegram.';

@Injectable()
export class VoiceTaskService {
  private readonly logger = new Logger(VoiceTaskService.name);

  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private notifications: NotificationsService,
    private telegram: TelegramService,
  ) {}

  /** Кнопки старых сообщений (vt:…), отправленных до перехода на помощника.
   *  Их ожидания жили в памяти процесса и после выкладки потеряны. */
  async handleCallback(data: string, _chatId: number): Promise<string | null> {
    if (!/^vt:/.test(data)) return null;
    return 'Запрос устарел — скажите заново';
  }

  /**
   * Просрочка по задачам, выданным голосом. Раз в час: срок прошёл, задача
   * не закрыта — сообщение основателю и исполнителю. Ровно одно на задачу:
   * дедуп держит createIfNotRecent по ключу, поэтому лишняя колонка в базе
   * не нужна.
   *
   * Штатный планировщик задач просрочки не шлёт — там @Cron снят, просрочки
   * считаются по Доске проектов. Эта проверка смотрит ТОЛЬКО голосовые
   * задачи и существующую логику доски не трогает.
   */
  @Cron('0 * * * *', { timeZone: 'Asia/Dushanbe' })
  async notifyOverdueVoiceTasks(): Promise<{ count: number }> {
    try {
      const rows = await this.taskRepo.createQueryBuilder('t')
        .where('t.deadline < NOW()')
        .andWhere('t.status NOT IN (:...done)', { done: [TaskStatus.DONE, TaskStatus.CANCELLED] })
        .andWhere('t.description LIKE :mark', { mark: `${VOICE_MARK}%` })
        // Смотрим только свежие: старые задачи разбирать поздно, а спам
        // при первом запуске после деплоя никому не нужен.
        .andWhere(`t.deadline > NOW() - INTERVAL '14 days'`)
        .take(100)
        .getMany();

      let count = 0;
      for (const t of rows) {
        const when = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Asia/Dushanbe', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(t.deadline as any));

        const assignee = t.assigneeId
          ? await this.userRepo.findOne({ where: { id: t.assigneeId } }).catch(() => null)
          : null;
        const who = assignee?.name || 'Исполнитель';
        const alertKey = `voice-overdue:${t.id}`;

        // Автору — кто сорвал срок.
        if (t.createdById) {
          const fresh = await this.notifications.createIfNotRecent({
            userId: t.createdById,
            type: NotificationType.TASK_OVERDUE,
            title: '⚠️ Срок прошёл, задача не сдана',
            message: t.assigneeId && t.assigneeId !== t.createdById
              ? `${who} не выполнил задачу «${t.title}». Срок был ${when}.`
              : `Задача «${t.title}» не выполнена. Срок был ${when}.`,
            link: `/tasks/${t.id}`,
            data: { alertKey },
          }, 24 * 30).catch(() => false);
          if (fresh) {
            count++;
            this.telegram.sendToUser(
              t.createdById,
              `<b>⚠️ Срок прошёл, задача не сдана</b>\n` +
              (t.assigneeId && t.assigneeId !== t.createdById ? `👤 ${esc(who)}\n` : '') +
              `${esc(t.title)}\n📅 срок был ${when}`,
            ).catch(() => { /* не критично */ });
          }
        }

        // Исполнителю — напоминание. Часто задача просто забыта.
        if (t.assigneeId && t.assigneeId !== t.createdById) {
          const fresh = await this.notifications.createIfNotRecent({
            userId: t.assigneeId,
            type: NotificationType.TASK_OVERDUE,
            title: '⚠️ Срок по задаче прошёл',
            message: `«${t.title}» — срок был ${when}. Закройте задачу или сообщите руководителю.`,
            link: `/tasks/${t.id}`,
            data: { alertKey },
          }, 24 * 30).catch(() => false);
          if (fresh) {
            this.telegram.sendToUser(
              t.assigneeId,
              `<b>⚠️ Срок по задаче прошёл</b>\n${esc(t.title)}\n📅 срок был ${when}`,
            ).catch(() => { /* не критично */ });
          }
        }
      }
      if (count) this.logger.log(`voice overdue: уведомлений ${count}`);
      return { count };
    } catch (e: any) {
      this.logger.warn(`voice overdue failed: ${e?.message || e}`);
      return { count: 0 };
    }
  }
}

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
