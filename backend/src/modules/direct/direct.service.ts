import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  DirectAttachment, DirectAttachmentKind, DirectConversation, DirectMessage, DirectReply, DirectSetting,
} from './direct.entity';
import type { DirectEvent, IncomingAttachment } from './instagram-events';
import { DirectFiles, MAX_AVATAR_SIZE, MAX_INCOMING_SIZE, type OpenedFile, type OutgoingFile, type UploadedFile } from './direct-files';
import { AudioConverter } from './audio-converter';
import { InstagramApi, instagramEnv } from './instagram.api';
import { failureOf, messagePreview, replyUntil, splitText } from './direct-text';
import { User } from '../users/user.entity';
import { hasGrant } from '../auth/permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.entity';
import { AppGateway } from '../gateway/app.gateway';
import { ClientsService } from '../clients/clients.service';
import { ClientLeadDirection } from '../clients/client-lead.entity';
import { getSalesSegment } from '../../common/sales-segment';
import { bindsOnReply, canLead, canReply, canTransfer, isTop } from './direct-access';

/** Имя и фото человека спрашиваем заново раз в неделю — их меняют. */
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Не удалось узнать профиль — повторяем не чаще, чем раз в 10 минут. */
const PROFILE_RETRY_MS = 10 * 60 * 1000;
/** Эхо только что отправленного из CRM приходит за секунды. */
const ECHO_WINDOW_MS = 2 * 60 * 1000;
/** Маркер меняем на свежий, когда до конца осталось меньше месяца. */
const REFRESH_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
/** Instagram не продлевает маркер младше суток. */
const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;
/** Сотрудник «сейчас в чате», пока его вкладка присылает пульс. */
const VIEWER_TTL_MS = 45 * 1000;

/** Звук, который играет любой браузер: прочее переводим в AAC. */
const PLAYABLE_SOUND = /^audio\/(mp4|x-m4a|m4a|aac|mpeg|mp3|wav|x-wav|wave)\b/;
/** Вложения, которые являются файлами и которые CRM сохраняет у себя. */
const FILE_KINDS = new Set<DirectAttachmentKind>(['image', 'video', 'audio', 'file', 'sticker', 'share', 'reel', 'story']);

/** Роли менеджеров продаж: им приходят пуши о новых сообщениях. */
const SALES_ROLES = new Set(['sales_manager_smm', 'sales_manager_dev']);

type Person = { id: string; name: string };

/** Что несёт исходящее: текст, файл или голосовое. */
type Content =
  | { text: string }
  | { file: OutgoingFile & { storedName: string; mimeType: string; size: number } }
  | { voice: { storedName: string; mimeType: string; size: number } };

/** Эхо прерванного перезапуском сообщения Meta может довезти позже — до 36 часов. */
const INTERRUPTED_ECHO_MS = 36 * 60 * 60 * 1000;
/** Сколько раз пробуем скачать файл сообщения, прежде чем оставить только ссылку. */
const MAX_FETCH_ATTEMPTS = 5;

/** Переход к сообщению: сколько сообщений от него до свежего показываем самое большее. */
const MAX_JUMP_MESSAGES = 1000;
/** И сколько раньше него — для контекста. */
const JUMP_CONTEXT = 20;
/** «Печатает…» в Instagram — не чаще раза в столько. */
const TYPING_EVERY_MS = 5000;

/** Почему реакция не ушла — по-человечески. */
const REACTION_FAILURE: Record<string, string> = {
  TOKEN_INVALID: 'Ключ Instagram больше не действует — сообщите администратору',
  WINDOW_CLOSED: 'Прошло 24 часа после сообщения клиента — реакцию можно поставить только в приложении Instagram',
  UNAVAILABLE: 'Клиент недоступен: заблокировал аккаунт или удалил свой',
  NETWORK: 'Сбой связи с Instagram — попробуйте ещё раз',
  REJECTED: 'Instagram не принял реакцию',
};

/** Фильтры списка поверх вкладки. */
export type ListFilters = { search?: string; assigneeId?: string; labelId?: string; lead?: 'with' | 'without'; reminder?: '1' };

/** Цитата в ленте: на что ответили. */
type ReplyPreview = { id: string | null; direction: string | null; preview: string; author: string | null };

/** Первая строка ответа query(): у UPDATE/DELETE TypeORM отдаёт [строки, число], у SELECT/INSERT — строки. */
const firstRow = (res: any): any => (Array.isArray(res?.[0]) ? res[0][0] : res?.[0]);
const isUniqueViolation = (error: any) => error?.code === '23505' || error?.driverError?.code === '23505';

@Injectable()
export class DirectService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DirectService.name);
  /** Кто сейчас открыл какой чат: conversationId → (userId → последний пульс). */
  private readonly viewers = new Map<string, Map<string, number>>();
  /** Кто имеет доступ к «Директу» — кэш на минуту. */
  private audienceCache: { at: number; all: string[]; push: string[] } | null = null;
  private readonly profileAttempts = new Map<string, number>();
  /** Когда последний раз слали «печатает» в чат. */
  private readonly typingAt = new Map<string, number>();
  private lastWebhookSavedAt = 0;

  constructor(
    @InjectRepository(DirectConversation) private readonly conversations: Repository<DirectConversation>,
    @InjectRepository(DirectMessage) private readonly messagesRepo: Repository<DirectMessage>,
    @InjectRepository(DirectAttachment) private readonly attachments: Repository<DirectAttachment>,
    @InjectRepository(DirectReply) private readonly replies: Repository<DirectReply>,
    @InjectRepository(DirectSetting) private readonly settings: Repository<DirectSetting>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly files: DirectFiles,
    private readonly audio: AudioConverter,
    private readonly instagram: InstagramApi,
    private readonly notifications: NotificationsService,
    private readonly gateway: AppGateway,
    private readonly clients: ClientsService,
  ) {}

  // ─── Что сообщает Instagram ─────────────────────────────────────────

  /** Применяет события уведомления. У каждого события id сообщения, поэтому
   *  повторная доставка ничего не меняет; сбой поднимается наверх — Meta повторит. */
  async receive(events: DirectEvent[]): Promise<void> {
    this.touchWebhook();
    const state = await this.instagram.state();
    for (const event of events) {
      // Аккаунт известен — чужие события пропускаем. Не узнали ещё (нет
      // ответа /me) — принимаем: подпись уже доказала, что это наша Meta.
      if (state?.accountId && event.accountId !== state.accountId) {
        this.logger.warn(`Событие другого аккаунта Instagram ${event.accountId} пропущено`);
        continue;
      }
      if (state && !state.accountId) {
        await this.instagram.update({ accountId: event.accountId });
        state.accountId = event.accountId;
      }
      if (event.kind === 'message') await (event.outgoing ? this.applyEcho(event) : this.applyIncoming(event));
      else if (event.kind === 'deleted') await this.applyDeleted(event.externalId);
      else if (event.kind === 'reaction') await this.applyReaction(event.externalId, event.emoji, event.byContact);
      else await this.applyRead(event.accountId, event.contactId, event.externalId);
    }
  }

  private async applyIncoming(event: Extract<DirectEvent, { kind: 'message' }>): Promise<void> {
    if (await this.messagesRepo.findOne({ where: { externalId: event.externalId }, select: ['id'] })) return;

    // Сообщение, вложения и счётчики чата — одной транзакцией: если сервер
    // упадёт посередине, Meta повторит уведомление, и оно запишется целиком,
    // а не застрянет полусохранённым (чат без «клиент писал» и без уведомления).
    let stored: { conversation: DirectConversation; created: boolean; message: DirectMessage; files: DirectAttachment[]; unread: number };
    try {
      stored = await this.conversations.manager.transaction(async (em) => {
        const { conversation, created } = await this.openConversation(event.accountId, event.contactId, event.sentAt, em);
        const messages = em.getRepository(DirectMessage);
        const message = await messages.save(messages.create({
          conversationId: conversation.id,
          direction: 'in',
          externalId: event.externalId,
          text: event.text,
          sentAt: event.sentAt,
          replyToExternalId: event.replyToId,
        }));
        const files = await this.saveIncomingAttachments(message.id, event.attachments, em);
        // Время переписки только растёт: сообщение может прийти с опозданием.
        const res = await em.query(
          `UPDATE direct_conversations
              SET "unreadCount" = "unreadCount" + 1,
                  "lastMessageAt" = GREATEST("lastMessageAt", $2),
                  "lastIncomingAt" = GREATEST(COALESCE("lastIncomingAt", $2), $2),
                  "waitingSince" = COALESCE("waitingSince", $2),
                  -- Клиент написал снова — чат возвращается из архива.
                  "archivedAt" = NULL, "archivedById" = NULL,
                  "updatedAt" = now()
            WHERE id = $1
            RETURNING "unreadCount"`,
          [conversation.id, event.sentAt],
        );
        return { conversation, created, message, files, unread: Number(firstRow(res)?.unreadCount ?? 1) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return; // то же уведомление пришло дважды одновременно
      throw error;
    }
    const { conversation, created, message, files, unread } = stored;
    const preview = messagePreview(message, files.map(a => a.kind));

    // После записи — фоном: профиль, уведомления, файлы. Meta уже получит 200.
    this.background((async () => {
      const stale = !conversation.profileCheckedAt || Date.now() - new Date(conversation.profileCheckedAt).getTime() > PROFILE_TTL_MS;
      if (created || stale) await this.refreshProfile(conversation.id);
      // Клиент ждёт, а тот, кто ведёт, больше не может ответить — чат открывается.
      const opened = await this.releaseStranded(conversation.id);
      // Сообщаем о первом непрочитанном: следующие ждут, пока чат откроют.
      if (unread === 1 || opened) await this.announce(conversation.id, preview, created);
      await this.fetchFiles(conversation.id, files);
    })());
    await this.pushMessage(conversation.id, message.id);
  }

  /** Что написало агентство: эхо сообщения из CRM или написанное прямо в приложении Instagram. */
  private async applyEcho(event: Extract<DirectEvent, { kind: 'message' }>): Promise<void> {
    if (await this.messagesRepo.findOne({ where: { externalId: event.externalId }, select: ['id'] })) return;

    let result: { conversationId: string; messageId: string; files: DirectAttachment[]; authorId?: string };
    try {
      result = await this.conversations.manager.transaction(async (em) => {
        const { conversation } = await this.openConversation(event.accountId, event.contactId, event.sentAt, em);
        // Своё сообщение CRM могло ещё ждать ответа API: эхо называет его
        // первым. Прерванное перезапуском (INTERRUPTED) тоже узнаём — значит,
        // оно всё-таки дошло, и повторять его нельзя.
        const waiting: { id: string; status: string; authorId: string; sentAt: Date }[] = await em.query(
          `SELECT id, status, "authorId", "sentAt" FROM direct_messages
            WHERE "conversationId" = $1 AND direction = 'out' AND "externalId" IS NULL
              AND "authorId" IS NOT NULL AND text IS NOT DISTINCT FROM $2
              AND ((status IN ('sending', 'sent') AND "sentAt" >= $3)
                OR (status = 'failed' AND error = 'INTERRUPTED' AND "sentAt" >= $4))
            ORDER BY "sentAt" ASC LIMIT 1
            FOR UPDATE`,
          [conversation.id, event.text, new Date(Date.now() - ECHO_WINDOW_MS), new Date(Date.now() - INTERRUPTED_ECHO_MS)],
        );
        if (waiting.length) {
          const match = waiting[0];
          await em.query(
            `UPDATE direct_messages SET "externalId" = $2, error = NULL,
                    status = CASE WHEN status IN ('sending', 'failed') THEN 'sent' ELSE status END
              WHERE id = $1`,
            [match.id, event.externalId],
          );
          // Прерванное не дошло до «ответил» в transmit — отмечаем здесь.
          if (match.status === 'failed') await this.answered(conversation.id, match.authorId, new Date(match.sentAt), em);
          return { conversationId: conversation.id, messageId: match.id, files: [], authorId: match.authorId };
        }

        const messages = em.getRepository(DirectMessage);
        const message = await messages.save(messages.create({
          conversationId: conversation.id,
          direction: 'out',
          externalId: event.externalId,
          text: event.text,
          status: 'sent',
          sentAt: event.sentAt,
          replyToExternalId: event.replyToId,
        }));
        const files = await this.saveIncomingAttachments(message.id, event.attachments, em);
        await em.query(
          `UPDATE direct_conversations SET "lastMessageAt" = GREATEST("lastMessageAt", $2), "updatedAt" = now() WHERE id = $1`,
          [conversation.id, event.sentAt],
        );
        // Ответ из приложения Instagram — тоже ответ: ожидание клиента закончилось.
        await this.answered(conversation.id, null, event.sentAt, em);
        return { conversationId: conversation.id, messageId: message.id, files };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
    if (result.files.length) this.background(this.fetchFiles(result.conversationId, result.files));
    // Сообщение из CRM дошло — а ответ API мог потеряться (сбой, перезапуск):
    // закрепление по первому ответу не должно от этого зависеть.
    if (result.authorId) {
      const author = await this.users.findOne({ where: { id: result.authorId } });
      if (author) await this.bindOnReplySafe(result.conversationId, author);
    }
    await this.pushMessage(result.conversationId, result.messageId);
  }

  /** Клиент удалил сообщение: текст и файлы уходят. */
  private async applyDeleted(externalId: string): Promise<void> {
    const message = await this.messagesRepo.findOne({ where: { externalId } });
    if (!message || message.deletedAt) return;
    const files = await this.attachments.find({ where: { messageId: message.id } });
    await this.messagesRepo.update(message.id, { deletedAt: new Date(), text: null });
    for (const file of files) await this.files.remove(file.storedName);
    await this.attachments.delete({ messageId: message.id });
    this.changed(message.conversationId);
  }

  /** Реакция клиента или агентства (из CRM или из приложения Instagram). null — сняли. */
  private async applyReaction(externalId: string, emoji: string | null, byContact: boolean): Promise<void> {
    const message = await this.messagesRepo.findOne({ where: { externalId }, select: ['id', 'conversationId'] });
    if (!message) return;
    const value = emoji ? emoji.slice(0, 16) : null;
    await this.messagesRepo.update(message.id, byContact ? { contactReaction: value } : { ourReaction: value });
    await this.pushMessage(message.conversationId, message.id, undefined, false);
  }

  /** Клиент прочитал переписку до этого сообщения. */
  private async applyRead(accountId: string, contactId: string, externalId: string): Promise<void> {
    const conversation = await this.conversations.findOne({ where: { channel: 'instagram', accountId, contactId } });
    if (!conversation) return;
    const seen = await this.messagesRepo.findOne({ where: { externalId }, select: ['id', 'sentAt'] });
    const res = await this.messagesRepo.query(
      `UPDATE direct_messages SET status = 'read'
        WHERE "conversationId" = $1 AND direction = 'out' AND status = 'sent'
          ${seen ? 'AND "sentAt" <= $2' : ''}`,
      seen ? [conversation.id, seen.sentAt] : [conversation.id],
    );
    if (Array.isArray(res) && Number(res[1] ?? 0) > 0) this.changed(conversation.id);
  }

  /** Переписка с человеком; два первых сообщения сразу открывают одну. */
  private async openConversation(accountId: string, contactId: string, at: Date, em: EntityManager = this.conversations.manager): Promise<{ conversation: DirectConversation; created: boolean }> {
    const repo = em.getRepository(DirectConversation);
    const found = await repo.findOne({ where: { channel: 'instagram', accountId, contactId } });
    if (found) return { conversation: found, created: false };
    const inserted = await em.query(
      `INSERT INTO direct_conversations (channel, "accountId", "contactId", "lastMessageAt")
       VALUES ('instagram', $1, $2, $3)
       ON CONFLICT (channel, "accountId", "contactId") DO NOTHING
       RETURNING id`,
      [accountId, contactId, at],
    );
    const conversation = await repo.findOneOrFail({ where: { channel: 'instagram', accountId, contactId } });
    return { conversation, created: inserted.length > 0 };
  }

  private async saveIncomingAttachments(messageId: string, list: IncomingAttachment[], em: EntityManager = this.conversations.manager): Promise<DirectAttachment[]> {
    if (!list.length) return [];
    const repo = em.getRepository(DirectAttachment);
    return repo.save(list.map(a => repo.create({
      messageId, kind: a.kind, url: a.url, name: a.title ? a.title.slice(0, 255) : null,
    })));
  }

  /** Спрашивает у Instagram имя и фото человека. */
  private async refreshProfile(conversationId: string): Promise<void> {
    const last = this.profileAttempts.get(conversationId) ?? 0;
    if (Date.now() - last < PROFILE_RETRY_MS) return;
    this.profileAttempts.set(conversationId, Date.now());
    const conversation = await this.conversations.findOne({ where: { id: conversationId } });
    if (!conversation) return;
    try {
      const profile = await this.instagram.profile(conversation.contactId);
      await this.conversations.update(conversation.id, {
        contactName: profile.name ? profile.name.slice(0, 200) : conversation.contactName,
        contactUsername: profile.username ? profile.username.slice(0, 200) : conversation.contactUsername,
        profileCheckedAt: new Date(),
      });
      this.profileAttempts.delete(conversationId);
      if (profile.picture) await this.storePicture(conversation.id, profile.picture);
      this.changed(conversation.id);
    } catch (error) {
      // Имя придёт позже: попробуем при следующем сообщении.
      this.logger.warn(`Профиль собеседника не получен: ${String(error)}`);
    }
  }

  private async storePicture(conversationId: string, url: string): Promise<void> {
    const download = await this.instagram.download(url, MAX_AVATAR_SIZE).catch(() => null);
    if (!download) return;
    const stored = await this.files.save(download.bytes, download.type, 'image');
    const current = await this.conversations.findOne({ where: { id: conversationId }, select: ['id', 'contactPicture'] });
    await this.conversations.update(conversationId, { contactPicture: stored.storedName });
    if (current?.contactPicture) await this.files.remove(current.contactPicture);
  }

  /** Сохраняет файлы сообщения: ссылки Instagram перестают работать через несколько дней. */
  private async fetchFiles(conversationId: string, list: DirectAttachment[]): Promise<void> {
    let kept = 0;
    for (const attachment of list) {
      if (attachment.storedName || !attachment.url || !FILE_KINDS.has(attachment.kind)) continue;
      try {
        const download = await this.instagram.download(attachment.url, MAX_INCOMING_SIZE);
        // Публикация или рилс по ссылке — это страница Instagram, а не файл:
        // сохранять её как .mp4 нельзя, остаётся ссылка «открыть в Instagram».
        if (/^(text\/|application\/(json|xhtml|xml))/i.test(download.type ?? '')) {
          await this.attachments.update(attachment.id, { fetchAttempts: MAX_FETCH_ATTEMPTS });
          continue;
        }
        const file = attachment.kind === 'audio' ? await this.playable(download) : download;
        const stored = await this.files.save(file.bytes, file.type, attachment.kind);
        const res = await this.attachments.query(
          `UPDATE direct_attachments SET "storedName" = $2, "mimeType" = $3, size = $4
            WHERE id = $1 AND "storedName" IS NULL`,
          [attachment.id, stored.storedName, stored.mimeType, stored.size],
        );
        // Его уже сохранила параллельная попытка — лишняя копия не нужна.
        if (Number(Array.isArray(res) ? res[1] : 0) === 0) await this.files.remove(stored.storedName);
        else kept += 1;
      } catch (error) {
        await this.attachments.query(
          `UPDATE direct_attachments SET "fetchAttempts" = "fetchAttempts" + 1 WHERE id = $1`, [attachment.id],
        ).catch(() => undefined);
        this.logger.warn(`Файл сообщения не сохранён: ${String(error)}`);
      }
    }
    if (kept) this.changed(conversationId);
  }

  /** Подчистка: файлы, которые не скачались с первого раза (сеть, выкладка
   *  посреди загрузки), и сообщения, чья отправка оборвалась перезапуском. */
  @Cron('*/10 * * * *')
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.failInterrupted().catch(e => this.logger.warn(`Подчистка отправок не удалась: ${e?.message || e}`));
    if (!this.instagram.connected) return;
    const rows: { id: string; conversationId: string }[] = await this.attachments.query(
      `SELECT a.id, m."conversationId" FROM direct_attachments a
         JOIN direct_messages m ON m.id = a."messageId"
        WHERE a."storedName" IS NULL AND a.url IS NOT NULL AND a."fetchAttempts" < $1
          AND a.kind IN ('image', 'video', 'audio', 'file', 'sticker', 'share', 'reel', 'story')
          AND a."createdAt" < now() - interval '2 minutes' AND a."createdAt" > now() - interval '3 days'
        ORDER BY a."createdAt" LIMIT 30`,
      [MAX_FETCH_ATTEMPTS],
    ).catch(() => []);
    const byConversation = new Map<string, string[]>();
    for (const r of rows) byConversation.set(r.conversationId, [...(byConversation.get(r.conversationId) ?? []), r.id]);
    for (const [conversationId, ids] of byConversation) {
      const list = await this.attachments.find({ where: { id: In(ids) } });
      await this.fetchFiles(conversationId, list).catch(e => this.logger.warn(`Повтор скачивания не удался: ${e?.message || e}`));
    }
  }

  /** Отправка оборвалась (сервер перезапускался): не «отправляется» вечно,
   *  а «не известно, дошло ли» — с кнопкой повтора. Если эхо всё же придёт,
   *  сообщение станет отправленным само (см. applyEcho). */
  private async failInterrupted(): Promise<void> {
    const res = await this.messagesRepo.query(
      `UPDATE direct_messages SET status = 'failed', error = 'INTERRUPTED'
        WHERE direction = 'out' AND status = 'sending' AND "sentAt" < now() - interval '2 minutes'
        RETURNING "conversationId"`,
    );
    const rows: { conversationId: string }[] = Array.isArray(res?.[0]) ? res[0] : [];
    for (const id of new Set(rows.map(r => r.conversationId))) this.changed(id);
  }

  private async playable(sound: { bytes: Buffer; type: string | null }): Promise<{ bytes: Buffer; type: string | null }> {
    if (PLAYABLE_SOUND.test(sound.type ?? '')) return sound;
    try {
      return { bytes: await this.audio.toM4a(sound.bytes), type: 'audio/mp4' };
    } catch (error) {
      this.logger.warn(`Звук сообщения сохранён как пришёл: ${String(error)}`);
      return sound;
    }
  }

  private background(task: Promise<void>): void {
    task.catch((error: unknown) => this.logger.error(`Фоновая задача «Директа»: ${String(error)}`));
  }

  // ─── Кто узнаёт о сообщениях ─────────────────────────────────────────

  /** Кто видит «Директ» (all) и кому слать пуши (push — менеджеры продаж и
   *  те, кому доступ выдан лично; руководство видит счётчик в меню). */
  private async audience(): Promise<{ all: string[]; push: string[] }> {
    if (this.audienceCache && Date.now() - this.audienceCache.at < 60_000) return this.audienceCache;
    const rows: any[] = await this.users.query(
      `SELECT id, role, "secondaryRole", "extraPermissions", "deniedPermissions"
         FROM users WHERE "isActive" = true AND COALESCE("isBlocked", false) = false`,
    );
    const all = rows.filter(u => hasGrant(u, 'clients.view'));
    const push = all.filter(u =>
      SALES_ROLES.has(u.role) || SALES_ROLES.has(u.secondaryRole)
      || (Array.isArray(u.extraPermissions) && u.extraPermissions.includes('clients.view')));
    this.audienceCache = { at: Date.now(), all: all.map(u => u.id), push: push.map(u => u.id) };
    return this.audienceCache;
  }

  /** Справочник меток изменился — страницы перечитывают метки и списки. */
  broadcastChanged(): void {
    this.audience()
      .then(({ all }) => {
        for (const userId of all) this.gateway.notifyUser(userId, 'direct:labels', {});
      })
      .catch(() => { /* живое обновление — не главное */ });
  }

  /** Говорит открытым страницам CRM, что чат изменился. */
  private changed(conversationId: string): void {
    this.audience()
      .then(({ all }) => {
        for (const userId of all) this.gateway.notifyUser(userId, 'direct:changed', { conversationId });
      })
      .catch(() => { /* живое обновление — не главное, данные уже в базе */ });
  }

  /** Шлёт открытым страницам само сообщение: лента и список обновляются
   *  сразу, без повторного запроса к серверу. clientId — метка временного
   *  пузыря на странице отправителя: по ней он заменяется настоящим. */
  private async pushMessage(conversationId: string, messageId: string, clientId?: string, withConversation = true): Promise<void> {
    try {
      const message = await this.messagesRepo.findOne({ where: { id: messageId }, relations: ['author'] });
      if (message) {
        const files = await this.attachments.find({ where: { messageId }, order: { createdAt: 'ASC' } });
        const dto = this.messageDto(message, files, clientId, await this.replyPreviews([message]));
        const { all } = await this.audience();
        // Кто ведёт чат — страница по нему решает, звенеть ли: менеджеру
        // звенят только его чаты и свободные.
        const [owner] = await this.conversations.query(`SELECT "assigneeId" FROM direct_conversations WHERE id = $1`, [conversationId]);
        const assigneeId: string | null = owner?.assigneeId ?? null;
        for (const userId of all) this.gateway.notifyUser(userId, 'direct:message', { conversationId, message: dto, assigneeId });
      }
    } catch (e: any) {
      this.logger.warn(`Живое обновление сообщения не ушло: ${e?.message || e}`);
    }
    if (withConversation) await this.pushConversation(conversationId);
  }

  /** Шлёт обновлённую строку чата: превью, непрочитанные, «ждёт ответа»,
   *  кто ответил последним. Кто сейчас в чате — все, страница уберёт себя сама. */
  async pushConversation(conversationId: string): Promise<void> {
    try {
      const row = await this.conversations.findOne({ where: { id: conversationId }, relations: ['lead', 'lastReplyBy', 'assignee'] });
      if (!row) return;
      const [conversation] = await this.decorate([row], '');
      const { all } = await this.audience();
      for (const userId of all) this.gateway.notifyUser(userId, 'direct:conversation', { conversationId, conversation });
    } catch (e: any) {
      this.logger.warn(`Живое обновление чата не ушло: ${e?.message || e}`);
    }
  }

  private async announce(conversationId: string, preview: string, isNew: boolean): Promise<void> {
    const conversation = await this.conversations.findOne({ where: { id: conversationId }, relations: ['assignee'] });
    if (!conversation) return;
    // Закреплённый чат — только его менеджеру; свободный — всем менеджерам продаж.
    const { push } = await this.audience();
    const owner = conversation.assignee && canLead(conversation.assignee) ? conversation.assignee.id : null;
    const recipients = owner ? [owner] : push;
    const watching = this.viewerIds(conversationId);
    const name = contactLabel(conversation);
    for (const userId of recipients) {
      if (watching.includes(userId)) continue; // чат и так открыт у него на экране
      await this.notifications.create({
        userId,
        type: isNew ? NotificationType.DIRECT_NEW_CHAT : NotificationType.DIRECT_MESSAGE,
        title: isNew ? `Новый чат в Директе: ${name}` : `Директ: ${name}`,
        message: preview,
        link: `/direct?c=${conversationId}`,
        data: { conversationId },
      }).catch(e => this.logger.warn(`Уведомление о сообщении не создано: ${e?.message || e}`));
    }
  }

  /** Агентство ответило: ожидание клиента закончилось, кто ответил — запоминаем,
   *  сколько ждал — в «Скорость ответа». userId null — ответ из приложения. */
  private async answered(conversationId: string, userId: string | null, at: Date, em: EntityManager = this.conversations.manager): Promise<void> {
    const rows: { waited: Date | null }[] = await em.query(
      `WITH prev AS (SELECT id, "waitingSince" FROM direct_conversations WHERE id = $1 FOR UPDATE)
       UPDATE direct_conversations c
          SET "waitingSince" = NULL, "lastReplyById" = $2, "lastReplyAt" = $3, "updatedAt" = now()
         FROM prev WHERE c.id = prev.id
       RETURNING prev."waitingSince" AS waited`,
      [conversationId, userId, at],
    );
    const raw = firstRow(rows);
    const waited = raw?.waited ? new Date(raw.waited) : null;
    if (!waited || waited > at) return;
    const replies = em.getRepository(DirectReply);
    await replies.save(replies.create({
      conversationId, userId, waitedSince: waited, answeredAt: at,
      seconds: Math.max(0, Math.round((at.getTime() - waited.getTime()) / 1000)),
    }));
  }

  // ─── Кто сейчас в чате ───────────────────────────────────────────────

  private viewerIds(conversationId: string): string[] {
    const map = this.viewers.get(conversationId);
    if (!map) return [];
    const now = Date.now();
    for (const [userId, at] of map) if (now - at > VIEWER_TTL_MS) map.delete(userId);
    return [...map.keys()];
  }

  /** Пульс открытого чата. Новый зритель — сообщаем остальным. */
  ping(userId: string, conversationId: string): void {
    const map = this.viewers.get(conversationId) ?? new Map<string, number>();
    const fresh = !map.has(userId) || Date.now() - (map.get(userId) ?? 0) > VIEWER_TTL_MS;
    map.set(userId, Date.now());
    this.viewers.set(conversationId, map);
    if (fresh) void this.pushConversation(conversationId);
  }

  leave(userId: string, conversationId: string): void {
    if (this.viewers.get(conversationId)?.delete(userId)) void this.pushConversation(conversationId);
  }

  // ─── Что читает CRM ─────────────────────────────────────────────────

  /**
   * Список чатов. Порядок: закреплённые, потом чаты, где у меня сработало
   * напоминание, потом по последнему сообщению. Сначала выбираем id нужной
   * страницы (сортировка по выражениям), потом сами чаты.
   */
  async list(user: User, query: ListFilters & { view?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const total = await this.filtered(query.view, user, query).getCount();
    const ids: string[] = (await this.filtered(query.view, user, query)
      .select('c.id', 'id')
      .addSelect('CASE WHEN c.pinnedAt IS NULL THEN 1 ELSE 0 END', 'pin_rank')
      .addSelect(
        `CASE WHEN EXISTS (SELECT 1 FROM direct_reminders dr WHERE dr."conversationId" = c.id AND dr."userId" = :sortMe
           AND dr."doneAt" IS NULL AND dr."remindAt" <= now()) THEN 0 ELSE 1 END`,
        'due_rank',
      )
      .setParameter('sortMe', user.id)
      .orderBy('pin_rank', 'ASC')
      .addOrderBy('due_rank', 'ASC')
      .addOrderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany()).map(r => r.id);
    if (!ids.length) return { items: [], total };
    const rows = await this.conversations.find({ where: { id: In(ids) }, relations: ['lead', 'lastReplyBy', 'assignee'] });
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { items: await this.decorate(rows, user.id), total };
  }

  async counts(user: User, filters: ListFilters = {}) {
    const views = ['all', 'mine', 'free', 'unread', 'waiting', 'archived'] as const;
    const numbers = await Promise.all(views.map(view => this.filtered(view, user, filters).getCount()));
    return Object.fromEntries(views.map((view, i) => [view, numbers[i]])) as Record<typeof views[number], number>;
  }

  /** Менеджеры продаж — кому можно передать чат и по кому фильтровать список. */
  async managers() {
    const rows: any[] = await this.users.query(
      `SELECT id, name, role, "secondaryRole", "extraPermissions", "deniedPermissions", "isActive", "isBlocked" FROM users
        WHERE "isActive" = true AND COALESCE("isBlocked", false) = false
        ORDER BY name`,
    );
    // role — именно роль продаж: у дизайнера с второй ролью МП это вторая роль.
    return rows.filter(u => canLead(u))
      .map(u => ({ id: u.id as string, name: u.name as string, role: (SALES_ROLES.has(u.role) ? u.role : u.secondaryRole) as string }));
  }

  /**
   * Передать чат другому менеджеру продаж или освободить (userId = null).
   * Руководство — любой чат, менеджер — только свой. В ленте остаётся отметка.
   */
  async assign(user: User, id: string, targetId: string | null) {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['assignee'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    if (!canTransfer(user, conversation.assigneeId)) {
      throw new ForbiddenException('Передать чат может только тот, кто его ведёт, или руководство');
    }
    let target: User | null = null;
    if (targetId) {
      target = await this.users.findOne({ where: { id: targetId } });
      if (!target || !canLead(target)) throw new BadRequestException('Чат можно передать только менеджеру продаж');
    }
    const prev = conversation.assigneeId ?? null;
    if (prev === (target?.id ?? null)) return this.get(user, id);

    // Права проверены по прочитанному «кто ведёт»; если за это время чат
    // передали или закрепили, запись не пройдёт — иначе менеджер мог бы
    // распорядиться чатом, который ему уже не принадлежит.
    const res = await this.conversations.query(
      `UPDATE direct_conversations SET "assigneeId" = $2, "assignedAt" = $3, "updatedAt" = now()
        WHERE id = $1 AND "assigneeId" IS NOT DISTINCT FROM $4`,
      [id, target?.id ?? null, target ? new Date() : null, prev],
    );
    if (Number(Array.isArray(res) ? res[1] : 0) !== 1) {
      throw new ConflictException('Пока вы выбирали, чат уже передали — посмотрите, кто его ведёт сейчас');
    }
    // Новый менеджер мог получить доступ минуту назад — живые события ему нужны сразу.
    if (target) this.audienceCache = null;
    const before = conversation.assignee?.name;
    const text = target
      ? (before ? `Чат передан: ${before} → ${target.name}` : `Чат закреплён за: ${target.name}`)
      : `Чат освобождён${before ? `: ${before} больше не ведёт клиента` : ''}`;
    await this.addEvent(id, user.id, text);
    // Новый менеджер узнаёт сразу — пушем и колокольчиком.
    if (target && target.id !== user.id) {
      await this.notifications.create({
        userId: target.id,
        type: NotificationType.DIRECT_MESSAGE,
        title: `Вам передан чат в Директе: ${contactLabel(conversation)}`,
        message: `Передал(а): ${user.name}`,
        link: `/direct?c=${id}`,
        data: { conversationId: id },
      }).catch(e => this.logger.warn(`Уведомление о передаче чата не создано: ${e?.message || e}`));
    }
    return this.get(user, id);
  }

  /** Отметка в ленте о том, кто ведёт чат. Клиенту не уходит. authorId null — отметка CRM. */
  private async addEvent(conversationId: string, authorId: string | null, text: string): Promise<void> {
    const event = await this.messagesRepo.save(this.messagesRepo.create({
      conversationId, direction: 'event', text, authorId, sentAt: new Date(),
    }));
    await this.pushMessage(conversationId, event.id);
  }

  /** Сколько чатов с непрочитанным — число у «Директа» в меню. */
  async unreadTotal(user: User): Promise<{ count: number }> {
    const qb = this.conversations.createQueryBuilder('c')
      .where('(c.unreadCount > 0 OR c.markedUnread = true)')
      .andWhere('c.archivedAt IS NULL');
    // Менеджеру — его чаты и свободные; руководство видит все.
    if (!isTop(user)) qb.andWhere('(c.assigneeId IS NULL OR c.assigneeId = :me)', { me: user.id });
    return { count: await qb.getCount() };
  }

  async get(user: User, id: string) {
    let row = await this.conversations.findOne({ where: { id }, relations: ['lead', 'lastReplyBy', 'assignee'] });
    if (!row) throw new NotFoundException('Чат не найден');
    if (await this.releaseStranded(row)) {
      row = await this.conversations.findOne({ where: { id }, relations: ['lead', 'lastReplyBy', 'assignee'] });
      if (!row) throw new NotFoundException('Чат не найден');
    }
    const [summary] = await this.decorate([row], user.id);
    return summary;
  }

  /**
   * Страница переписки. before — более ранние, чем это сообщение. until —
   * переход к сообщению (поиск, цитата): всё от него до самого свежего и
   * немного раньше для контекста; если оно слишком далеко — обычная страница.
   */
  async messages(id: string, query: { before?: string; until?: string; limit?: number }) {
    await this.conversation(id);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const page = (query.until && await this.pageUntil(id, query.until)) || await this.pageBefore(id, query.before, limit);
    const files = page.items.length ? await this.attachments.find({ where: { messageId: In(page.items.map(m => m.id)) }, order: { createdAt: 'ASC' } }) : [];
    const byMessage = new Map<string, DirectAttachment[]>();
    for (const f of files) byMessage.set(f.messageId, [...(byMessage.get(f.messageId) ?? []), f]);
    const replies = await this.replyPreviews(page.items);
    return { items: page.items.map(m => this.messageDto(m, byMessage.get(m.id) ?? [], undefined, replies)), hasMore: page.hasMore };
  }

  private feedQuery(id: string) {
    return this.messagesRepo.createQueryBuilder('m')
      .leftJoinAndSelect('m.author', 'author')
      .where('m.conversationId = :id', { id });
  }

  private async pageBefore(id: string, beforeId: string | undefined, limit: number): Promise<{ items: DirectMessage[]; hasMore: boolean }> {
    const before = beforeId
      ? await this.messagesRepo.findOne({ where: { id: beforeId, conversationId: id }, select: ['id', 'sentAt'] })
      : null;
    const qb = this.feedQuery(id).orderBy('m.sentAt', 'DESC').addOrderBy('m.id', 'DESC').take(limit + 1);
    if (before) qb.andWhere('(m.sentAt < :at OR (m.sentAt = :at AND m.id < :mid))', { at: before.sentAt, mid: before.id });
    const rows = await qb.getMany();
    return { items: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
  }

  private async pageUntil(id: string, targetId: string): Promise<{ items: DirectMessage[]; hasMore: boolean } | null> {
    const target = await this.messagesRepo.findOne({ where: { id: targetId, conversationId: id }, select: ['id', 'sentAt'] });
    if (!target) return null;
    const newer = await this.feedQuery(id)
      .andWhere('(m.sentAt > :at OR (m.sentAt = :at AND m.id >= :mid))', { at: target.sentAt, mid: target.id })
      .orderBy('m.sentAt', 'DESC').addOrderBy('m.id', 'DESC')
      .take(MAX_JUMP_MESSAGES + 1)
      .getMany();
    if (newer.length > MAX_JUMP_MESSAGES) return null;
    const older = await this.feedQuery(id)
      .andWhere('(m.sentAt < :at OR (m.sentAt = :at AND m.id < :mid))', { at: target.sentAt, mid: target.id })
      .orderBy('m.sentAt', 'DESC').addOrderBy('m.id', 'DESC')
      .take(JUMP_CONTEXT + 1)
      .getMany();
    return { items: [...older.slice(0, JUMP_CONTEXT).reverse(), ...newer.reverse()], hasMore: older.length > JUMP_CONTEXT };
  }

  /** Сотрудник открыл чат: сообщения прочитаны, его уведомления о чате — тоже. */
  async markRead(user: User, id: string): Promise<void> {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['assignee'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    this.ping(user.id, id);
    // Закреплённый чат «прочитан», когда его открыл тот, кто ведёт: коллега
    // или руководство, заглянув, не снимают у менеджера отметку о новом.
    // Тот, кто ведёт, больше не может вести клиентов — как свободный.
    const owner = conversation.assignee;
    const mayClear = !owner || owner.id === user.id || !canLead(owner);
    if ((conversation.unreadCount > 0 || conversation.markedUnread) && mayClear) {
      await this.conversations.update(id, { unreadCount: 0, markedUnread: false });
      await this.pushConversation(id);
    }
    await this.notifications.markReadByLink(user.id, `/direct?c=${id}`).catch(() => 0);
  }

  // ─── Что пишет CRM ──────────────────────────────────────────────────

  async sendText(user: User, id: string, text: string, publicBase: string, clientId?: string, replyToId?: string) {
    const conversation = await this.writable(user, id);
    const replyTo = await this.replyTarget(conversation.id, replyToId);
    return this.sendTexts(user, conversation, text, publicBase, clientId, replyTo);
  }

  async sendFile(user: User, id: string, upload: UploadedFile | undefined, text: string | undefined, publicBase: string, clientId?: string, replyToId?: string) {
    const conversation = await this.writable(user, id);
    const replyTo = await this.replyTarget(conversation.id, replyToId);
    const file = this.files.checkOutgoing(upload);
    const stored = await this.files.saveOutgoing(file);
    const first = await this.deliver(user, conversation, { file: { ...file, ...stored } }, publicBase, clientId, replyTo);
    const rest = text?.trim() && first.status !== 'failed' ? await this.sendTexts(user, conversation, text, publicBase, clientId) : [];
    return [first, ...rest];
  }

  /** На что отвечаем: сообщение этого чата, которое Instagram знает (есть mid). */
  private async replyTarget(conversationId: string, replyToId: string | undefined): Promise<string | null> {
    if (!replyToId) return null;
    const target = await this.messagesRepo.findOne({ where: { id: replyToId, conversationId }, select: ['id', 'externalId', 'direction', 'deletedAt'] });
    if (!target || (target.direction !== 'in' && target.direction !== 'out')) throw new BadRequestException('Сообщение для ответа не найдено');
    if (!target.externalId || target.deletedAt) throw new BadRequestException('На это сообщение ответить цитатой нельзя');
    return target.externalId;
  }

  async sendVoice(user: User, id: string, upload: UploadedFile | undefined, publicBase: string, clientId?: string) {
    const conversation = await this.writable(user, id);
    const recorded = this.files.checkVoice(upload);
    let sound: Buffer;
    try {
      sound = await this.audio.toM4a(recorded);
    } catch (error) {
      this.logger.warn(`Голосовое не переведено в AAC: ${String(error)}`);
      throw new BadRequestException('Не удалось обработать запись — запишите ещё раз');
    }
    const stored = await this.files.saveSound(sound);
    return this.deliver(user, conversation, { voice: stored }, publicBase, clientId);
  }

  /** Повтор неотправленного: сообщение переезжает в конец переписки. */
  async retry(user: User, messageId: string, publicBase: string) {
    const message = await this.messagesRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Сообщение не найдено');
    if (message.status !== 'failed') throw new ConflictException('Сообщение уже отправлено');
    const conversation = await this.writable(user, message.conversationId);
    // Двое нажали «Повторить» одновременно (или двойной клик) — уйдёт один раз:
    // в «отправляется» сообщение переводит только первый.
    const res = await this.messagesRepo.query(
      `UPDATE direct_messages SET status = 'sending', error = NULL, "authorId" = $2, "sentAt" = now()
        WHERE id = $1 AND status = 'failed'`,
      [message.id, user.id],
    );
    if (Number(Array.isArray(res) ? res[1] : 0) !== 1) throw new ConflictException('Сообщение уже отправляется');
    await this.touchLastMessage(conversation.id, new Date());
    return this.transmit(conversation, message.id, publicBase);
  }

  async addNote(user: User, id: string, text: string, clientId?: string, mentions?: string[]) {
    const conversation = await this.conversation(id);
    const note = await this.messagesRepo.save(this.messagesRepo.create({
      conversationId: id, direction: 'note', text: text.trim(), authorId: user.id, sentAt: new Date(),
    }));
    await this.pushMessage(id, note.id, clientId);
    if (mentions?.length) this.background(this.notifyMentions(user, conversation, note, mentions));
    return this.messageDto({ ...note, author: user } as DirectMessage, [], clientId);
  }

  /** @Имя в заметке — коллеге уведомление (только тем, кто видит «Директ»). */
  private async notifyMentions(author: User, conversation: DirectConversation, note: DirectMessage, ids: string[]): Promise<void> {
    const { all } = await this.audience();
    const targets = this.uniq(ids).filter(id => id !== author.id && all.includes(id));
    for (const userId of targets) {
      await this.notifications.create({
        userId,
        type: NotificationType.DIRECT_MENTION,
        title: `${author.name} упомянул(а) вас в Директе: ${contactLabel(conversation)}`,
        message: (note.text || '').slice(0, 300),
        link: `/direct?c=${conversation.id}`,
        data: { conversationId: conversation.id, messageId: note.id },
      }).catch(e => this.logger.warn(`Уведомление об упоминании не создано: ${e?.message || e}`));
    }
  }

  /** Реакция ❤️ на сообщение клиента (или снять её). Как ответ: только в
   *  своём или свободном чате и пока открыто окно 24 часов. */
  async react(user: User, messageId: string, on: boolean) {
    const message = await this.messagesRepo.findOne({ where: { id: messageId } });
    if (!message || message.direction !== 'in') throw new NotFoundException('Сообщение не найдено');
    if (!message.externalId || message.deletedAt) throw new ConflictException('На это сообщение реакцию поставить нельзя');
    const conversation = await this.writable(user, message.conversationId);
    try {
      await this.instagram.react(conversation.contactId, message.externalId, on);
    } catch (error) {
      const failure = failureOf(error);
      this.logger.warn(`Реакция в Instagram не ушла (${failure}): ${String(error)}`);
      if (failure === 'TOKEN_INVALID') await this.markToken(true);
      throw new ConflictException(REACTION_FAILURE[failure] ?? REACTION_FAILURE.REJECTED);
    }
    await this.messagesRepo.update(message.id, { ourReaction: on ? '❤️' : null });
    await this.pushMessage(conversation.id, message.id, undefined, false);
    const fresh = await this.messagesRepo.findOneOrFail({ where: { id: message.id }, relations: ['author'] });
    return this.messageDto(fresh, await this.attachments.find({ where: { messageId: message.id } }), undefined, await this.replyPreviews([fresh]));
  }

  /** «Печатает…» у клиента, пока сотрудник набирает ответ. Тихо: не вышло — не беда. */
  async typing(user: User, id: string): Promise<void> {
    const last = this.typingAt.get(id) ?? 0;
    if (Date.now() - last < TYPING_EVERY_MS) return;
    const conversation = await this.writable(user, id).catch(() => null);
    if (!conversation) return;
    this.typingAt.set(id, Date.now());
    if (this.typingAt.size > 500) {
      for (const [key, at] of this.typingAt) if (Date.now() - at > 60_000) this.typingAt.delete(key);
    }
    await this.instagram.typing(conversation.contactId)
      .catch(e => this.logger.debug(`«Печатает» не ушло: ${e?.message || e}`));
  }

  // ─── Закреп, архив, «непрочитанное», метки ──────────────────────────

  /** Менять закреп, архив, метки чата может тот, кто вправе в нём отвечать:
   *  ведущий менеджер и руководство; свободный чат — любой с доступом. */
  private async manageable(user: User, id: string): Promise<DirectConversation> {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['assignee'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    if (!canReply(user, conversation.assigneeId)) {
      throw new ForbiddenException(`Чат ведёт ${conversation.assignee?.name || 'другой менеджер'} — закреп, архив и метки меняет он или руководство`);
    }
    return conversation;
  }

  async setPinned(user: User, id: string, on: boolean) {
    await this.manageable(user, id);
    await this.conversations.update(id, on ? { pinnedAt: new Date(), pinnedById: user.id } : { pinnedAt: null, pinnedById: null });
    await this.pushConversation(id);
    return this.get(user, id);
  }

  /** В архив — у всей команды; закреп при этом снимается. */
  async setArchived(user: User, id: string, on: boolean) {
    await this.manageable(user, id);
    await this.conversations.update(id, on
      ? { archivedAt: new Date(), archivedById: user.id, pinnedAt: null, pinnedById: null }
      : { archivedAt: null, archivedById: null });
    await this.pushConversation(id);
    return this.get(user, id);
  }

  async setMarkedUnread(user: User, id: string, on: boolean) {
    await this.manageable(user, id);
    await this.conversations.update(id, { markedUnread: on });
    await this.pushConversation(id);
    return this.get(user, id);
  }

  async setLabels(user: User, id: string, labelIds: string[]) {
    await this.manageable(user, id);
    const wanted = this.uniq(labelIds);
    if (wanted.length) {
      const [{ count }] = await this.conversations.query(`SELECT count(*)::int AS count FROM direct_labels WHERE id = ANY($1::uuid[])`, [wanted]);
      if (count !== wanted.length) throw new BadRequestException('Такой метки нет — обновите страницу');
    }
    await this.conversations.manager.transaction(async (em) => {
      await em.query(`DELETE FROM direct_conversation_labels WHERE "conversationId" = $1 AND NOT ("labelId" = ANY($2::uuid[]))`, [id, wanted]);
      for (const labelId of wanted) {
        await em.query(
          `INSERT INTO direct_conversation_labels ("conversationId", "labelId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, labelId],
        );
      }
    });
    await this.pushConversation(id);
    return this.get(user, id);
  }

  // ─── Карточка клиента, команда, поиск ───────────────────────────────

  /** Правая панель чата: лид с контактами, фото и файлы, заметки, напоминания. */
  async details(user: User, id: string) {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['lead'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    const media: any[] = await this.attachments.query(
      `SELECT a.id, a.kind, a."mimeType", a.name, a.size, a."messageId", m."sentAt", m.direction
         FROM direct_attachments a JOIN direct_messages m ON m.id = a."messageId"
        WHERE m."conversationId" = $1 AND a."storedName" IS NOT NULL AND m."deletedAt" IS NULL
        ORDER BY m."sentAt" DESC, a."createdAt" DESC LIMIT 120`,
      [id],
    );
    const notes = await this.messagesRepo.find({
      where: { conversationId: id, direction: 'note' }, relations: ['author'], order: { sentAt: 'DESC' }, take: 30,
    });
    const reminders: any[] = await this.conversations.query(
      `SELECT r.id, r."remindAt", r.note, r."firedAt", r."userId", u.name
         FROM direct_reminders r LEFT JOIN users u ON u.id = r."userId"
        WHERE r."conversationId" = $1 AND r."doneAt" IS NULL
        ORDER BY r."remindAt"`,
      [id],
    );
    const lead = conversation.lead;
    const ownerName = lead?.ownerId ? (await this.namesOf([lead.ownerId])).get(lead.ownerId) ?? null : null;
    const visual = (a: any) => /^(image|video)\//.test(a.mimeType || '') && a.kind !== 'file' && a.kind !== 'audio';
    return {
      lead: lead ? {
        id: lead.id, name: lead.name, status: lead.status,
        phone: lead.contactPhone || null, email: lead.contactEmail || null, instagram: lead.contactInstagram || null,
        contactPerson: lead.contactPerson || null, sphere: lead.sphere || null, nextStep: lead.nextStep || null,
        nextContactAt: lead.nextContactAt ?? null, dealPotential: lead.dealPotential ?? null,
        owner: lead.ownerId ? { id: lead.ownerId, name: ownerName ?? 'Сотрудник' } : null,
      } : null,
      media: media.filter(visual).slice(0, 60).map(a => ({
        id: a.id, kind: a.kind, mimeType: a.mimeType, messageId: a.messageId, sentAt: a.sentAt,
        url: this.files.signedPath('media', a.id),
      })),
      files: media.filter(a => a.kind === 'file').slice(0, 30).map(a => ({
        id: a.id, name: a.name, size: a.size, messageId: a.messageId, sentAt: a.sentAt, url: this.files.signedPath('media', a.id),
      })),
      notes: notes.map(n => ({
        id: n.id, text: n.text, sentAt: n.sentAt,
        author: n.author ? { id: n.author.id, name: n.author.name } : null,
      })),
      reminders: reminders.map(r => ({
        id: r.id, remindAt: r.remindAt, note: r.note, fired: !!r.firedAt,
        user: { id: r.userId, name: r.name ?? 'Сотрудник' }, mine: r.userId === user.id,
      })),
    };
  }

  /** Кто видит «Директ» — для @упоминаний в заметках. */
  async team(): Promise<{ id: string; name: string }[]> {
    const { all } = await this.audience();
    const names = await this.namesOf(all);
    return [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  /** Поиск по тексту сообщений и заметок — во всех чатах или в одном. */
  async search(q: string, conversationId?: string) {
    const words = q.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (words.length < 2) return { items: [] };
    const like = `%${words.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    const rows: any[] = await this.messagesRepo.query(
      `SELECT m.id, m."conversationId", m.direction, m.text, m."sentAt", m."authorId"
         FROM direct_messages m
        WHERE m.direction IN ('in', 'out', 'note') AND m."deletedAt" IS NULL AND m.text ILIKE $1
          ${conversationId ? 'AND m."conversationId" = $2' : ''}
        ORDER BY m."sentAt" DESC LIMIT 40`,
      conversationId ? [like, conversationId] : [like],
    );
    if (!rows.length) return { items: [] };
    const chats = await this.conversations.find({ where: { id: In(this.uniq(rows.map(r => r.conversationId))) } });
    const byId = new Map(chats.map(c => [c.id, c]));
    const names = await this.namesOf(this.uniq(rows.map(r => r.authorId).filter(Boolean)));
    return {
      items: rows.filter(r => byId.has(r.conversationId)).map(r => {
        const chat = byId.get(r.conversationId)!;
        return {
          messageId: r.id,
          conversationId: r.conversationId,
          direction: r.direction,
          sentAt: r.sentAt,
          snippet: snippetOf(r.text || '', words),
          author: r.authorId ? { id: r.authorId, name: names.get(r.authorId) ?? 'Сотрудник' } : null,
          contact: {
            label: contactLabel(chat),
            username: chat.contactUsername,
            picture: chat.contactPicture ? this.files.signedPath('avatar', chat.id) : null,
          },
          archived: !!chat.archivedAt,
        };
      }),
    };
  }

  async deleteNote(user: User, noteId: string): Promise<void> {
    const note = await this.messagesRepo.findOne({ where: { id: noteId } });
    if (!note || note.direction !== 'note') throw new NotFoundException('Заметка не найдена');
    if (note.authorId !== user.id && !isTop(user)) throw new ForbiddenException('Удалить можно только свою заметку');
    await this.messagesRepo.delete(note.id);
    this.changed(note.conversationId);
  }

  /** «Создать лид»: карточка в Базе клиентов, направление — по менеджеру. */
  async createLead(user: User, id: string, dto: any) {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['lead', 'assignee'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    if (conversation.lead) throw new ConflictException('Лид из этого чата уже создан');
    await this.releaseStranded(conversation);
    if (!canReply(user, conversation.assigneeId)) {
      throw new ForbiddenException(`Клиента ведёт ${conversation.assignee?.name || 'другой менеджер'} — лид заводит закреплённый менеджер или руководство`);
    }
    // Лид — у того, кто ведёт клиента; в свободном чате (или если он больше
    // не может вести клиентов) — у создавшего.
    const owner: User = conversation.assignee && canLead(conversation.assignee) ? conversation.assignee : user;
    const segment = getSalesSegment(owner.role) ?? getSalesSegment(owner.secondaryRole);
    const direction = (segment?.leadDirection as ClientLeadDirection | undefined) ?? dto.direction;
    // ownerId — всегда тот, кто ведёт: чужое значение из запроса не принимаем.
    const lead = await this.clients.create({ ...dto, direction, ownerId: owner.id }, owner.id, { id: user.id, name: user.name });
    await this.conversations.update(id, { leadId: lead.id });
    await this.pushConversation(id);
    return { leadId: lead.id };
  }

  private async sendTexts(user: User, conversation: DirectConversation, text: string, publicBase: string, clientId?: string, replyTo: string | null = null) {
    const sent: any[] = [];
    for (const [i, part] of splitText(text).entries()) {
      // Цитата — только у первой части длинного текста.
      const message = await this.deliver(user, conversation, { text: part }, publicBase, clientId, i === 0 ? replyTo : null);
      sent.push(message);
      if (message.status === 'failed') break;
    }
    return sent;
  }

  /** Сначала пишем сообщение в переписку, потом отдаём Instagram: эхо найдёт его ждущим. */
  private async deliver(user: User, conversation: DirectConversation, content: Content, publicBase: string, clientId?: string, replyTo: string | null = null) {
    const sentAt = new Date();
    const message = await this.messagesRepo.save(this.messagesRepo.create({
      conversationId: conversation.id,
      direction: 'out',
      status: 'sending',
      authorId: user.id,
      sentAt,
      text: 'text' in content ? content.text : null,
      replyToExternalId: replyTo,
    }));
    if ('file' in content) {
      await this.attachments.save(this.attachments.create({
        messageId: message.id, kind: content.file.kind,
        storedName: content.file.storedName, mimeType: content.file.mimeType, size: content.file.size,
        name: content.file.name, isPublic: true,
      }));
    } else if ('voice' in content) {
      await this.attachments.save(this.attachments.create({
        messageId: message.id, kind: 'audio', storedName: content.voice.storedName,
        mimeType: content.voice.mimeType, size: content.voice.size, isPublic: true,
      }));
    }
    await this.touchLastMessage(conversation.id, sentAt);
    // «Отправляется» видно всем сразу — ещё до ответа Instagram.
    await this.pushMessage(conversation.id, message.id, clientId);
    return this.transmit(conversation, message.id, publicBase, clientId);
  }

  private async transmit(conversation: DirectConversation, messageId: string, publicBase: string, clientId?: string) {
    const message = await this.messagesRepo.findOneOrFail({ where: { id: messageId }, relations: ['author'] });
    const [file] = await this.attachments.find({ where: { messageId } });
    let delivered = false;
    try {
      const to = conversation.contactId;
      let externalId: string;
      const replyTo = message.replyToExternalId;
      if (file?.storedName) {
        const link = `${publicBase}/api/public/direct-files/${file.storedName}`;
        const type = file.kind === 'audio' || file.kind === 'image' || file.kind === 'video' ? file.kind : 'file';
        externalId = await this.instagram.sendAttachment(to, type, link, replyTo);
      } else {
        externalId = await this.instagram.sendText(to, message.text ?? '', replyTo);
      }
      // Эхо могло прийти раньше ответа и записаться как сообщение из
      // приложения — это то же сообщение.
      await this.messagesRepo.query(`DELETE FROM direct_messages WHERE "externalId" = $1 AND id <> $2`, [externalId, message.id]);
      await this.messagesRepo.query(
        `UPDATE direct_messages SET "externalId" = $2, error = NULL,
                status = CASE WHEN status = 'read' THEN 'read' ELSE 'sent' END
          WHERE id = $1`,
        [message.id, externalId],
      );
      await this.answered(conversation.id, message.authorId, new Date());
      await this.markToken(false);
      delivered = true;
    } catch (error) {
      const failure = failureOf(error);
      this.logger.warn(`Сообщение в Instagram не ушло (${failure}): ${String(error)}`);
      if (failure === 'TOKEN_INVALID') await this.markToken(true);
      await this.messagesRepo.update(message.id, { status: 'failed', error: failure });
    }
    // Закрепление — после отправки и отдельно от неё: его сбой не должен
    // превращать дошедшее сообщение в «не доставлено» (и в повторную отправку).
    if (delivered && message.author) await this.bindOnReplySafe(conversation.id, message.author);
    if (delivered && message.authorId) await this.closeAnsweredReminders(conversation.id, message.authorId);
    await this.pushMessage(conversation.id, messageId, clientId);
    const fresh = await this.messagesRepo.findOneOrFail({ where: { id: messageId }, relations: ['author'] });
    return this.messageDto(fresh, await this.attachments.find({ where: { messageId } }), clientId, await this.replyPreviews([fresh]));
  }

  /** Ответил клиенту после срока напоминания — оно выполнено. */
  private async closeAnsweredReminders(conversationId: string, userId: string): Promise<void> {
    try {
      const res = await this.messagesRepo.query(
        `UPDATE direct_reminders SET "doneAt" = now()
          WHERE "conversationId" = $1 AND "userId" = $2 AND "doneAt" IS NULL AND "remindAt" <= now()
          RETURNING id`,
        [conversationId, userId],
      );
      const rows = Array.isArray(res?.[0]) ? res[0] : [];
      if (rows.length) this.gateway.notifyUser(userId, 'direct:reminders', { conversationId });
    } catch (e: any) {
      this.logger.warn(`Напоминание не закрыто: ${e?.message || e}`);
    }
  }

  /** Закрепление по ответу без права уронить то, что уже сделано (отправку, эхо). */
  private async bindOnReplySafe(conversationId: string, author: User): Promise<void> {
    await this.bindOnReply(conversationId, author)
      .catch(e => this.logger.warn(`Чат ${conversationId} не закреплён за ${author.id}: ${e?.message || e}`));
  }

  /** Первый ответ менеджера продаж закрепляет свободный чат за ним.
   *  Ответы руководства и из приложения Instagram не закрепляют. */
  private async bindOnReply(conversationId: string, author: User): Promise<void> {
    if (!bindsOnReply(author, null)) return;
    // Двое ответили одновременно — чат достаётся первому, второй просто ответил.
    const res = await this.conversations.query(
      `UPDATE direct_conversations SET "assigneeId" = $2, "assignedAt" = now(), "updatedAt" = now()
        WHERE id = $1 AND "assigneeId" IS NULL`,
      [conversationId, author.id],
    );
    if (Number(Array.isArray(res) ? res[1] : 0) !== 1) return;
    await this.addEvent(conversationId, author.id, `Чат закреплён за: ${author.name} — первый ответ клиенту`);
  }

  /**
   * Тот, кто ведёт чат, больше не может вести клиентов (уволен, заблокирован,
   * ушёл из продаж), а клиент ждёт ответа — чат освобождается, в ленте
   * отметка. Пока клиент не пишет, закрепление не трогаем: блокировка могла
   * быть на день, а руководство может передать чат и само.
   * Принимает чат с загруженным assignee (тогда правит его) или id.
   */
  private async releaseStranded(target: DirectConversation | string): Promise<boolean> {
    const conversation = typeof target === 'string'
      ? await this.conversations.findOne({ where: { id: target }, relations: ['assignee'] })
      : target;
    const owner = conversation?.assignee;
    if (!conversation || !owner || !conversation.waitingSince || canLead(owner)) return false;
    const res = await this.conversations.query(
      `UPDATE direct_conversations SET "assigneeId" = NULL, "assignedAt" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "assigneeId" = $2`,
      [conversation.id, owner.id],
    );
    if (Number(Array.isArray(res) ? res[1] : 0) !== 1) {
      // Чат как раз передали — берём того, кто ведёт теперь.
      const fresh = await this.conversations.findOne({ where: { id: conversation.id }, relations: ['assignee'] });
      conversation.assignee = fresh?.assignee ?? null;
      conversation.assigneeId = fresh?.assigneeId ?? null;
      conversation.assignedAt = fresh?.assignedAt ?? null;
      return false;
    }
    conversation.assignee = null;
    conversation.assigneeId = null;
    conversation.assignedAt = null;
    const why = owner.isActive === false || owner.isBlocked ? 'сейчас без доступа к CRM' : 'больше не в отделе продаж';
    await this.addEvent(conversation.id, null, `Чат освобождён: ${owner.name} ${why}, а клиент ждёт ответа`);
    return true;
  }

  private async markToken(invalid: boolean): Promise<void> {
    const state = await this.instagram.state();
    if (state && state.invalid !== invalid) await this.instagram.update({ invalid });
  }

  /** Можно ли сейчас написать в чат: Instagram подключён, окно 24 часов
   *  открыто и чат не закреплён за другим менеджером. */
  private async writable(user: User, id: string): Promise<DirectConversation> {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['assignee'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    await this.releaseStranded(conversation);
    if (!canReply(user, conversation.assigneeId)) {
      throw new ForbiddenException(`Чат ведёт ${conversation.assignee?.name || 'другой менеджер'} — клиенту отвечает закреплённый менеджер или руководство`);
    }
    if (!this.instagram.connected) throw new ConflictException('Instagram ещё не подключён к CRM');
    const until = replyUntil(conversation);
    if (!until) throw new ConflictException('Клиент ещё не писал — Instagram не даёт написать первым');
    if (until.getTime() <= Date.now()) {
      throw new ConflictException('Прошло больше 24 часов после последнего сообщения клиента — ответьте из приложения Instagram');
    }
    return conversation;
  }

  private async conversation(id: string): Promise<DirectConversation> {
    const conversation = await this.conversations.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('Чат не найден');
    return conversation;
  }

  private async touchLastMessage(conversationId: string, at: Date): Promise<void> {
    await this.conversations.query(
      `UPDATE direct_conversations SET "lastMessageAt" = GREATEST("lastMessageAt", $2), "updatedAt" = now() WHERE id = $1`,
      [conversationId, at],
    );
  }

  // ─── Файлы ──────────────────────────────────────────────────────────

  /** Файл, который отправляем мы, — для Instagram: только такие без входа. */
  async publicFile(name: string): Promise<OpenedFile> {
    const exists = await this.attachments.findOne({ where: { storedName: name, isPublic: true }, select: ['id'] });
    if (!exists) throw new NotFoundException();
    return this.files.open(name);
  }

  async media(id: string): Promise<OpenedFile & { name: string | null; kind: DirectAttachmentKind }> {
    const attachment = await this.attachments.findOne({ where: { id } });
    if (!attachment?.storedName) throw new NotFoundException();
    return { ...(await this.files.open(attachment.storedName)), name: attachment.kind === 'file' ? attachment.name : null, kind: attachment.kind };
  }

  async avatar(id: string): Promise<OpenedFile> {
    const conversation = await this.conversations.findOne({ where: { id }, select: ['id', 'contactPicture'] });
    if (!conversation?.contactPicture) throw new NotFoundException();
    return this.files.open(conversation.contactPicture);
  }

  // ─── Подключение и статистика ───────────────────────────────────────

  async status(publicBase: string) {
    const env = instagramEnv();
    const state = await this.instagram.state();
    const webhook = await this.settings.findOne({ where: { key: 'instagram_webhook' } });
    return {
      connected: env.connected,
      configured: { token: !!env.accessToken, secret: !!env.appSecret, verifyToken: !!env.verifyToken },
      account: state?.username ?? null,
      accountId: state?.accountId ?? null,
      tokenExpiresAt: state?.expiresAt ?? null,
      tokenRefreshedAt: state?.refreshedAt ?? null,
      tokenInvalid: state?.invalid ?? false,
      lastWebhookAt: webhook?.value?.at ?? null,
      storagePersistent: this.files.storageIsPersistent(),
      webhookUrl: `${publicBase}/api/webhooks/instagram`,
    };
  }

  /** «Аналитика» за период (только руководству): по каждому менеджеру продаж — сколько клиентов
   *  ведёт, сколько ответов и как быстро, сколько лидов и сделок; плюс все,
   *  кто отвечал (руководство, ответы из приложения Instagram). */
  async stats(user: User, fromIso?: string, toIso?: string) {
    // Цифры по каждому менеджеру видит только руководство (решение владельца).
    if (!isTop(user)) throw new ForbiddenException('«Аналитика» Директа доступна только руководству');
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso ? new Date(fromIso) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Неверный период');
    const rows: any[] = await this.replies.query(
      `SELECT r."userId" AS "userId", u.name AS name,
              count(*)::int AS replies,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.seconds))::int AS median,
              round(avg(r.seconds))::int AS average,
              count(*) FILTER (WHERE r.seconds <= 900)::int AS fast
         FROM direct_replies r
         LEFT JOIN users u ON u.id = r."userId"
        WHERE r."answeredAt" >= $1 AND r."answeredAt" < $2
        GROUP BY r."userId", u.name
        ORDER BY replies DESC`,
      [from, to],
    );
    const [waiting] = await this.conversations.query(
      `SELECT count(*)::int AS count, min("waitingSince") AS since FROM direct_conversations WHERE "waitingSince" IS NOT NULL`,
    );
    // Клиенты по менеджерам: закреплено сейчас, новых за период, ждут ответа.
    const clients: any[] = await this.conversations.query(
      `SELECT "assigneeId" AS "userId", count(*)::int AS clients,
              count(*) FILTER (WHERE "assignedAt" >= $1 AND "assignedAt" < $2)::int AS "newClients",
              count(*) FILTER (WHERE "waitingSince" IS NOT NULL)::int AS waiting
         FROM direct_conversations WHERE "assigneeId" IS NOT NULL
        GROUP BY "assigneeId"`,
      [from, to],
    );
    // Лиды из чатов «Директа», созданные за период, и сколько из них стали
    // сделкой. Считаем по владельцу лида — как в Базе клиентов: при передаче
    // чата лид остаётся за тем, кто его завёл. client_leads."createdAt" —
    // время БЕЗ пояса (по часам базы): ::timestamptz у границ заставляет
    // Postgres сравнивать моменты, а не цифры на часах.
    const leads: any[] = await this.conversations.query(
      `SELECT l."ownerId" AS "userId", count(*)::int AS leads,
              count(*) FILTER (WHERE l.status::text = 'won')::int AS deals
         FROM direct_conversations c JOIN client_leads l ON l.id = c."leadId"
        WHERE l."ownerId" IS NOT NULL AND l."createdAt" >= $1::timestamptz AND l."createdAt" < $2::timestamptz
        GROUP BY l."ownerId"`,
      [from, to],
    );
    const managers = await this.managers();
    const byId = new Map<string | null, any>();
    const row = (userId: string | null, name: string, isManager: boolean) => {
      if (!byId.has(userId)) {
        byId.set(userId, {
          userId, name, isManager, clients: 0, newClients: 0, waiting: 0,
          replies: 0, median: null, average: null, fast: 0, leads: 0, deals: 0,
        });
      }
      return byId.get(userId);
    };
    for (const m of managers) row(m.id, m.name, true);
    for (const r of rows) {
      Object.assign(row(r.userId, r.userId ? (r.name || 'Сотрудник') : 'Из приложения Instagram', false), {
        replies: r.replies, median: r.median, average: r.average, fast: r.fast,
      });
    }
    const names = await this.namesOf(this.uniq([...clients, ...leads].map(r => r.userId)));
    for (const c of clients) Object.assign(row(c.userId, names.get(c.userId) ?? 'Сотрудник', false), { clients: c.clients, newClients: c.newClients, waiting: c.waiting });
    for (const l of leads) Object.assign(row(l.userId, names.get(l.userId) ?? 'Сотрудник', false), { leads: l.leads, deals: l.deals });
    const managerIds = new Set(managers.map(m => m.id));
    const people = [...byId.values()]
      .map(p => ({ ...p, isManager: p.userId !== null && managerIds.has(p.userId) }))
      // Сначала менеджеры продаж по числу клиентов, потом руководство, «из приложения» — в конце.
      .sort((a, b) => Number(b.isManager) - Number(a.isManager)
        || Number(a.userId === null) - Number(b.userId === null)
        || b.clients - a.clients || b.replies - a.replies || a.name.localeCompare(b.name, 'ru'));
    const [free] = await this.conversations.query(`SELECT count(*)::int AS count FROM direct_conversations WHERE "assigneeId" IS NULL`);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      people,
      waiting: { count: waiting?.count ?? 0, since: waiting?.since ?? null },
      freeClients: free?.count ?? 0,
    };
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.checkAccount().catch(e => this.logger.warn(`Проверка аккаунта Instagram не удалась: ${e?.message || e}`));
    this.sweep().catch(e => this.logger.warn(`Подчистка «Директа» при запуске не удалась: ${e?.message || e}`));
  }

  /** Узнаём аккаунт и имя — заодно видно, работает ли маркер. */
  async checkAccount(): Promise<void> {
    const state = await this.instagram.state();
    if (!state || (state.username && state.accountId && !state.invalid)) return;
    try {
      const me = await this.instagram.me();
      await this.instagram.update({ username: me.username, accountId: state.accountId || me.accountId, invalid: false });
      this.logger.log(`Instagram подключён: @${me.username}`);
    } catch (error) {
      this.logger.warn(`Instagram не принял маркер: ${String(error)}`);
      if (failureOf(error) === 'TOKEN_INVALID') await this.instagram.update({ invalid: true });
    }
  }

  /** Раз в сутки: меняем маркер на свежий за месяц до конца его 60 дней. */
  @Cron('0 4 * * *', { timeZone: 'Asia/Dushanbe' })
  async refreshToken(now: Date = new Date()): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    const state = await this.instagram.state();
    if (!state) return;
    if (state.expiresAt && new Date(state.expiresAt).getTime() - now.getTime() > REFRESH_BEFORE_MS) return;
    if (state.refreshedAt && now.getTime() - new Date(state.refreshedAt).getTime() < MIN_TOKEN_AGE_MS) return;
    try {
      const fresh = await this.instagram.refreshToken(state.token);
      await this.instagram.update({
        token: fresh.token,
        expiresAt: new Date(now.getTime() + fresh.expiresIn * 1000).toISOString(),
        refreshedAt: now.toISOString(),
        invalid: false,
      });
      this.logger.log('Маркер Instagram продлён на 60 дней');
    } catch (error) {
      this.logger.warn(`Маркер Instagram не продлён: ${String(error)}`);
      if (failureOf(error) === 'TOKEN_INVALID') await this.instagram.update({ invalid: true });
    }
  }

  /** Время последнего уведомления от Meta — видно в настройках, доходит ли вебхук. */
  private touchWebhook(): void {
    if (Date.now() - this.lastWebhookSavedAt < 60_000) return;
    this.lastWebhookSavedAt = Date.now();
    this.settings.save({ key: 'instagram_webhook', value: { at: new Date().toISOString() } })
      .catch(() => { /* не мешаем приёму */ });
  }

  // ─── Сборка ответов ─────────────────────────────────────────────────

  private filtered(view: string | undefined, user: User, filters: ListFilters = {}) {
    const { search, assigneeId, labelId, lead, reminder } = filters;
    const qb = this.conversations.createQueryBuilder('c');
    const searching = !!(search || '').trim();
    // Архив — своя вкладка; поиск во «Всех» находит и архивные (как в Telegram).
    if (view === 'archived') qb.andWhere('c.archivedAt IS NOT NULL');
    else if (!(searching && (!view || view === 'all'))) qb.andWhere('c.archivedAt IS NULL');
    if (view === 'unread') qb.andWhere('(c.unreadCount > 0 OR c.markedUnread = true)');
    if (view === 'waiting') qb.andWhere('c.waitingSince IS NOT NULL');
    // «Непрочитанные» и «Ждут ответа» — очередь работы: менеджеру — его чаты
    // и свободные (чужие он не прочитает и не ответит), руководству — все.
    if ((view === 'unread' || view === 'waiting') && !isTop(user)) {
      qb.andWhere('(c.assigneeId IS NULL OR c.assigneeId = :me)', { me: user.id });
    }
    if (view === 'mine') qb.andWhere('c.assigneeId = :me', { me: user.id });
    if (view === 'free') qb.andWhere('c.assigneeId IS NULL');
    if (assigneeId) qb.andWhere('c.assigneeId = :aid', { aid: assigneeId });
    if (labelId) {
      qb.andWhere(`EXISTS (SELECT 1 FROM direct_conversation_labels fl WHERE fl."conversationId" = c.id AND fl."labelId" = :labelId)`, { labelId });
    }
    if (lead === 'with') qb.andWhere('c.leadId IS NOT NULL');
    if (lead === 'without') qb.andWhere('c.leadId IS NULL');
    if (reminder) {
      qb.andWhere(`EXISTS (SELECT 1 FROM direct_reminders fr WHERE fr."conversationId" = c.id AND fr."userId" = :remMe AND fr."doneAt" IS NULL)`, { remMe: user.id });
    }
    const words = (search || '').trim().replace(/^@/, '').slice(0, 100);
    if (words) {
      const like = `%${words.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      qb.andWhere('(c.contactName ILIKE :like OR c.contactUsername ILIKE :like)', { like });
    }
    return qb;
  }

  /** Последнее сообщение каждого чата (без заметок) — для списка. */
  private async lastMessages(ids: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    if (!ids.length) return map;
    const rows: any[] = await this.messagesRepo.query(
      `SELECT DISTINCT ON (m."conversationId") m."conversationId", m.id, m.direction, m.text, m.status,
              m."authorId", m."sentAt", m."deletedAt",
              (SELECT a.kind FROM direct_attachments a WHERE a."messageId" = m.id ORDER BY a."createdAt" LIMIT 1) AS kind
         FROM direct_messages m
        WHERE m."conversationId" = ANY($1::uuid[]) AND m.direction NOT IN ('note', 'event')
        ORDER BY m."conversationId", m."sentAt" DESC, m.id DESC`,
      [ids],
    );
    for (const r of rows) map.set(r.conversationId, r);
    return map;
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.users.find({ where: { id: In(ids) }, select: ['id', 'name'] });
    return new Map(rows.map(u => [u.id, u.name]));
  }

  private uniq(ids: string[]): string[] {
    return [...new Set(ids.filter(Boolean))];
  }

  /** Метки чатов: conversationId → метки по порядку справочника. */
  private async labelsOf(ids: string[]): Promise<Map<string, { id: string; name: string; color: string }[]>> {
    const map = new Map<string, { id: string; name: string; color: string }[]>();
    if (!ids.length) return map;
    const rows: any[] = await this.conversations.query(
      `SELECT cl."conversationId", l.id, l.name, l.color
         FROM direct_conversation_labels cl JOIN direct_labels l ON l.id = cl."labelId"
        WHERE cl."conversationId" = ANY($1::uuid[])
        ORDER BY l."sortOrder", l.name`,
      [ids],
    );
    for (const r of rows) map.set(r.conversationId, [...(map.get(r.conversationId) ?? []), { id: r.id, name: r.name, color: r.color }]);
    return map;
  }

  /** Строки чатов для страницы: последнее сообщение, имена, метки. */
  private async decorate(rows: DirectConversation[], meId: string) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const [last, labels] = await Promise.all([this.lastMessages(ids), this.labelsOf(ids)]);
    const names = await this.namesOf(this.uniq([
      ...rows.flatMap(r => this.viewerIds(r.id)),
      ...rows.map(r => r.archivedById).filter(Boolean) as string[],
      ...[...last.values()].map(m => m.authorId).filter(Boolean) as string[],
    ]));
    return rows.map(r => this.summary(r, last.get(r.id) ?? null, names, meId, labels.get(r.id) ?? []));
  }

  /** Как выглядят цитаты: mid → короткое описание сообщения, на которое ответили. */
  private async replyPreviews(messages: Pick<DirectMessage, 'replyToExternalId'>[]): Promise<Map<string, ReplyPreview>> {
    const mids = this.uniq(messages.map(m => m.replyToExternalId).filter(Boolean) as string[]);
    const map = new Map<string, ReplyPreview>();
    if (!mids.length) return map;
    const rows: any[] = await this.messagesRepo.query(
      `SELECT m.id, m."externalId", m.direction, m.text, m."authorId", m."deletedAt",
              (SELECT a.kind FROM direct_attachments a WHERE a."messageId" = m.id ORDER BY a."createdAt" LIMIT 1) AS kind
         FROM direct_messages m WHERE m."externalId" = ANY($1::varchar[])`,
      [mids],
    );
    const names = await this.namesOf(this.uniq(rows.map(r => r.authorId).filter(Boolean)));
    for (const r of rows) {
      map.set(r.externalId, {
        id: r.id,
        direction: r.direction,
        preview: messagePreview({ text: r.text, deletedAt: r.deletedAt }, r.kind ? [r.kind] : []),
        author: r.direction === 'out' ? (r.authorId ? names.get(r.authorId) ?? 'Сотрудник' : 'Instagram') : null,
      });
    }
    return map;
  }

  private summary(row: DirectConversation, last: any | null, names: Map<string, string>, meId: string, labels: { id: string; name: string; color: string }[] = []) {
    const viewers = this.viewerIds(row.id).filter(id => id !== meId).map(id => ({ id, name: names.get(id) ?? 'Сотрудник' }));
    return {
      id: row.id,
      contact: {
        name: row.contactName,
        username: row.contactUsername,
        label: contactLabel(row),
        picture: row.contactPicture ? this.files.signedPath('avatar', row.id) : null,
      },
      lastMessage: last ? {
        preview: messagePreview({ text: last.text, deletedAt: last.deletedAt }, last.kind ? [last.kind] : []),
        direction: last.direction,
        status: last.status,
        at: last.sentAt,
        author: last.authorId ? { id: last.authorId, name: names.get(last.authorId) ?? 'Сотрудник' } : null,
      } : null,
      lastMessageAt: row.lastMessageAt,
      unreadCount: row.unreadCount,
      waitingSince: row.waitingSince,
      lastReply: row.lastReplyAt ? {
        at: row.lastReplyAt,
        by: row.lastReplyBy ? { id: row.lastReplyBy.id, name: row.lastReplyBy.name } : null,
      } : null,
      replyUntil: replyUntil(row),
      lead: row.lead ? { id: row.lead.id, name: row.lead.name, status: row.lead.status } : null,
      /** Менеджер продаж, который ведёт клиента; null — чат свободный. */
      assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.name } : null,
      assignedAt: row.assignedAt,
      viewers,
      /** Закреплён сверху у всей команды. */
      pinned: !!row.pinnedAt,
      /** В архиве — когда и кто убрал. */
      archived: row.archivedAt ? { at: row.archivedAt, by: row.archivedById ? names.get(row.archivedById) ?? null : null } : null,
      /** «Пометили непрочитанным». */
      markedUnread: !!row.markedUnread,
      labels,
    };
  }

  private messageDto(m: DirectMessage, files: DirectAttachment[], clientId?: string, replies: Map<string, ReplyPreview> = new Map()) {
    return {
      id: m.id,
      /** Метка временного пузыря отправителя (не хранится в базе). */
      clientId: clientId ?? null,
      direction: m.direction,
      text: m.text,
      status: m.status,
      error: m.error,
      author: m.author ? { id: m.author.id, name: m.author.name } : (m.authorId ? { id: m.authorId, name: 'Сотрудник' } : null),
      /** Исходящее без автора — написано в самом приложении Instagram. */
      fromApp: m.direction === 'out' && !m.authorId,
      sentAt: m.sentAt,
      deleted: !!m.deletedAt,
      reaction: m.contactReaction,
      /** Реакция агентства (❤️ из CRM или из приложения). */
      ourReaction: m.ourReaction ?? null,
      /** Цитата: на какое сообщение это ответ. id null — оригинала нет в CRM. */
      replyTo: m.replyToExternalId
        ? (replies.get(m.replyToExternalId) ?? { id: null, direction: null, preview: 'Сообщение', author: null })
        : null,
      attachments: files.map(f => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        url: f.storedName ? this.files.signedPath('media', f.id) : null,
        /** Оригинал в Instagram — публикация, рилс, сторис. */
        link: f.url,
      })),
    };
  }
}

/** Кусок текста вокруг найденного — для выдачи поиска. */
export function snippetOf(text: string, words: string, around = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0 || flat.length <= around * 2 + words.length) return flat.slice(0, around * 2 + words.length);
  const start = Math.max(0, at - around);
  const end = Math.min(flat.length, at + words.length + around);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Как CRM называет человека: по имени, по @нику, иначе — «Клиент Instagram». */
export function contactLabel(c: { contactName: string | null; contactUsername: string | null }): string {
  return c.contactName || (c.contactUsername ? `@${c.contactUsername}` : 'Клиент Instagram');
}
