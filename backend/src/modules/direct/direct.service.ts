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
      else if (event.kind === 'reaction') await this.applyReaction(event.externalId, event.byContact ? event.emoji : undefined);
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
      // Сообщаем о первом непрочитанном: следующие ждут, пока чат откроют.
      if (unread === 1) await this.announce(conversation.id, preview, created);
      await this.fetchFiles(conversation.id, files);
    })());
    this.changed(conversation.id, true);
  }

  /** Что написало агентство: эхо сообщения из CRM или написанное прямо в приложении Instagram. */
  private async applyEcho(event: Extract<DirectEvent, { kind: 'message' }>): Promise<void> {
    if (await this.messagesRepo.findOne({ where: { externalId: event.externalId }, select: ['id'] })) return;

    let result: { conversationId: string; files: DirectAttachment[] };
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
          return { conversationId: conversation.id, files: [] };
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
        return { conversationId: conversation.id, files };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
    if (result.files.length) this.background(this.fetchFiles(result.conversationId, result.files));
    this.changed(result.conversationId);
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

  /** Реакция клиента. undefined — реагировало агентство, это не храним. */
  private async applyReaction(externalId: string, emoji: string | null | undefined): Promise<void> {
    if (emoji === undefined) return;
    const message = await this.messagesRepo.findOne({ where: { externalId }, select: ['id', 'conversationId'] });
    if (!message) return;
    await this.messagesRepo.update(message.id, { contactReaction: emoji ? emoji.slice(0, 16) : null });
    this.changed(message.conversationId);
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

  /** Говорит открытым страницам CRM, что чат изменился. */
  private changed(conversationId: string, incoming = false): void {
    this.audience()
      .then(({ all }) => {
        for (const userId of all) this.gateway.notifyUser(userId, 'direct:changed', { conversationId, incoming });
      })
      .catch(() => { /* живое обновление — не главное, данные уже в базе */ });
  }

  private async announce(conversationId: string, preview: string, isNew: boolean): Promise<void> {
    const conversation = await this.conversations.findOne({ where: { id: conversationId } });
    if (!conversation) return;
    const { push } = await this.audience();
    const watching = this.viewerIds(conversationId);
    const name = contactLabel(conversation);
    for (const userId of push) {
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
    if (fresh) this.changed(conversationId);
  }

  leave(userId: string, conversationId: string): void {
    if (this.viewers.get(conversationId)?.delete(userId)) this.changed(conversationId);
  }

  // ─── Что читает CRM ─────────────────────────────────────────────────

  async list(user: User, query: { view?: string; search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const qb = this.filtered(query.view, query.search)
      .leftJoinAndSelect('c.lead', 'lead')
      .leftJoinAndSelect('c.lastReplyBy', 'replier')
      .orderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(limit)
      .skip(offset);
    const [rows, total] = await qb.getManyAndCount();
    const last = await this.lastMessages(rows.map(r => r.id));
    const names = await this.namesOf(this.uniq([
      ...rows.flatMap(r => this.viewerIds(r.id)),
      ...[...last.values()].map(m => m.authorId).filter(Boolean) as string[],
    ]));
    return { items: rows.map(r => this.summary(r, last.get(r.id) ?? null, names, user.id)), total };
  }

  async counts(search?: string) {
    const [all, unread, waiting] = await Promise.all([
      this.filtered('all', search).getCount(),
      this.filtered('unread', search).getCount(),
      this.filtered('waiting', search).getCount(),
    ]);
    return { all, unread, waiting };
  }

  /** Сколько чатов с непрочитанным — число у «Директа» в меню. */
  async unreadTotal(): Promise<{ count: number }> {
    return { count: await this.conversations.createQueryBuilder('c').where('c.unreadCount > 0').getCount() };
  }

  async get(user: User, id: string) {
    const row = await this.conversations.findOne({ where: { id }, relations: ['lead', 'lastReplyBy'] });
    if (!row) throw new NotFoundException('Чат не найден');
    const last = await this.lastMessages([row.id]);
    const names = await this.namesOf(this.uniq([...this.viewerIds(row.id), ...[...last.values()].map(m => m.authorId).filter(Boolean) as string[]]));
    return this.summary(row, last.get(row.id) ?? null, names, user.id);
  }

  async messages(id: string, query: { before?: string; limit?: number }) {
    await this.conversation(id);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const before = query.before
      ? await this.messagesRepo.findOne({ where: { id: query.before, conversationId: id }, select: ['id', 'sentAt'] })
      : null;
    const qb = this.messagesRepo.createQueryBuilder('m')
      .leftJoinAndSelect('m.author', 'author')
      .where('m.conversationId = :id', { id })
      .orderBy('m.sentAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(limit + 1);
    if (before) qb.andWhere('(m.sentAt < :at OR (m.sentAt = :at AND m.id < :mid))', { at: before.sentAt, mid: before.id });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit).reverse();
    const files = page.length ? await this.attachments.find({ where: { messageId: In(page.map(m => m.id)) }, order: { createdAt: 'ASC' } }) : [];
    const byMessage = new Map<string, DirectAttachment[]>();
    for (const f of files) byMessage.set(f.messageId, [...(byMessage.get(f.messageId) ?? []), f]);
    return { items: page.map(m => this.messageDto(m, byMessage.get(m.id) ?? [])), hasMore: rows.length > limit };
  }

  /** Сотрудник открыл чат: сообщения прочитаны, его уведомления о чате — тоже. */
  async markRead(user: User, id: string): Promise<void> {
    const conversation = await this.conversation(id);
    this.ping(user.id, id);
    if (conversation.unreadCount > 0) {
      await this.conversations.update(id, { unreadCount: 0 });
      this.changed(id);
    }
    await this.notifications.markReadByLink(user.id, `/direct?c=${id}`).catch(() => 0);
  }

  // ─── Что пишет CRM ──────────────────────────────────────────────────

  async sendText(user: User, id: string, text: string, publicBase: string) {
    const conversation = await this.writable(id);
    return this.sendTexts(user, conversation, text, publicBase);
  }

  async sendFile(user: User, id: string, upload: UploadedFile | undefined, text: string | undefined, publicBase: string) {
    const conversation = await this.writable(id);
    const file = this.files.checkOutgoing(upload);
    const stored = await this.files.saveOutgoing(file);
    const first = await this.deliver(user, conversation, { file: { ...file, ...stored } }, publicBase);
    const rest = text?.trim() && first.status !== 'failed' ? await this.sendTexts(user, conversation, text, publicBase) : [];
    return [first, ...rest];
  }

  async sendVoice(user: User, id: string, upload: UploadedFile | undefined, publicBase: string) {
    const conversation = await this.writable(id);
    const recorded = this.files.checkVoice(upload);
    let sound: Buffer;
    try {
      sound = await this.audio.toM4a(recorded);
    } catch (error) {
      this.logger.warn(`Голосовое не переведено в AAC: ${String(error)}`);
      throw new BadRequestException('Не удалось обработать запись — запишите ещё раз');
    }
    const stored = await this.files.saveSound(sound);
    return this.deliver(user, conversation, { voice: stored }, publicBase);
  }

  /** Повтор неотправленного: сообщение переезжает в конец переписки. */
  async retry(user: User, messageId: string, publicBase: string) {
    const message = await this.messagesRepo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Сообщение не найдено');
    if (message.status !== 'failed') throw new ConflictException('Сообщение уже отправлено');
    const conversation = await this.writable(message.conversationId);
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

  async addNote(user: User, id: string, text: string) {
    await this.conversation(id);
    const note = await this.messagesRepo.save(this.messagesRepo.create({
      conversationId: id, direction: 'note', text: text.trim(), authorId: user.id, sentAt: new Date(),
    }));
    this.changed(id);
    return this.messageDto({ ...note, author: user } as DirectMessage, []);
  }

  async deleteNote(user: User, noteId: string): Promise<void> {
    const note = await this.messagesRepo.findOne({ where: { id: noteId } });
    if (!note || note.direction !== 'note') throw new NotFoundException('Заметка не найдена');
    const isTop = user.role === 'admin' || user.role === 'founder';
    if (note.authorId !== user.id && !isTop) throw new ForbiddenException('Удалить можно только свою заметку');
    await this.messagesRepo.delete(note.id);
    this.changed(note.conversationId);
  }

  /** «Создать лид»: карточка в Базе клиентов, направление — по менеджеру. */
  async createLead(user: User, id: string, dto: any) {
    const conversation = await this.conversations.findOne({ where: { id }, relations: ['lead'] });
    if (!conversation) throw new NotFoundException('Чат не найден');
    if (conversation.lead) throw new ConflictException('Лид из этого чата уже создан');
    const direction = (getSalesSegment(user.role)?.leadDirection as ClientLeadDirection | undefined) ?? dto.direction;
    const lead = await this.clients.create({ ...dto, direction }, user.id, { id: user.id, name: user.name });
    await this.conversations.update(id, { leadId: lead.id });
    this.changed(id);
    return { leadId: lead.id };
  }

  private async sendTexts(user: User, conversation: DirectConversation, text: string, publicBase: string) {
    const sent: any[] = [];
    for (const part of splitText(text)) {
      const message = await this.deliver(user, conversation, { text: part }, publicBase);
      sent.push(message);
      if (message.status === 'failed') break;
    }
    return sent;
  }

  /** Сначала пишем сообщение в переписку, потом отдаём Instagram: эхо найдёт его ждущим. */
  private async deliver(user: User, conversation: DirectConversation, content: Content, publicBase: string) {
    const sentAt = new Date();
    const message = await this.messagesRepo.save(this.messagesRepo.create({
      conversationId: conversation.id,
      direction: 'out',
      status: 'sending',
      authorId: user.id,
      sentAt,
      text: 'text' in content ? content.text : null,
    }));
    if ('file' in content) {
      await this.attachments.save(this.attachments.create({
        messageId: message.id, kind: content.file.kind === 'image' ? 'image' : 'file',
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
    this.changed(conversation.id);
    return this.transmit(conversation, message.id, publicBase);
  }

  private async transmit(conversation: DirectConversation, messageId: string, publicBase: string) {
    const message = await this.messagesRepo.findOneOrFail({ where: { id: messageId } });
    const [file] = await this.attachments.find({ where: { messageId } });
    try {
      const to = conversation.contactId;
      let externalId: string;
      if (file?.storedName) {
        const link = `${publicBase}/api/public/direct-files/${file.storedName}`;
        const type = file.kind === 'audio' ? 'audio' : file.kind === 'image' ? 'image' : 'file';
        externalId = await this.instagram.sendAttachment(to, type, link);
      } else {
        externalId = await this.instagram.sendText(to, message.text ?? '');
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
      this.changed(conversation.id);
    } catch (error) {
      const failure = failureOf(error);
      this.logger.warn(`Сообщение в Instagram не ушло (${failure}): ${String(error)}`);
      if (failure === 'TOKEN_INVALID') await this.markToken(true);
      await this.messagesRepo.update(message.id, { status: 'failed', error: failure });
      this.changed(conversation.id);
    }
    const fresh = await this.messagesRepo.findOneOrFail({ where: { id: messageId }, relations: ['author'] });
    return this.messageDto(fresh, await this.attachments.find({ where: { messageId } }));
  }

  private async markToken(invalid: boolean): Promise<void> {
    const state = await this.instagram.state();
    if (state && state.invalid !== invalid) await this.instagram.update({ invalid });
  }

  /** Можно ли сейчас написать в чат: Instagram подключён и окно 24 часов открыто. */
  private async writable(id: string): Promise<DirectConversation> {
    const conversation = await this.conversation(id);
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

  /** «Скорость ответа» за период: по каждому, кто отвечал. */
  async stats(fromIso?: string, toIso?: string) {
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
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      people: rows.map(r => ({
        userId: r.userId, name: r.userId ? (r.name || 'Сотрудник') : 'Из приложения Instagram',
        replies: r.replies, median: r.median, average: r.average, fast: r.fast,
      })),
      waiting: { count: waiting?.count ?? 0, since: waiting?.since ?? null },
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

  private filtered(view: string | undefined, search: string | undefined) {
    const qb = this.conversations.createQueryBuilder('c');
    if (view === 'unread') qb.andWhere('c.unreadCount > 0');
    if (view === 'waiting') qb.andWhere('c.waitingSince IS NOT NULL');
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
        WHERE m."conversationId" = ANY($1::uuid[]) AND m.direction <> 'note'
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

  private summary(row: DirectConversation, last: any | null, names: Map<string, string>, meId: string) {
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
      viewers,
    };
  }

  private messageDto(m: DirectMessage, files: DirectAttachment[]) {
    return {
      id: m.id,
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

/** Как CRM называет человека: по имени, по @нику, иначе — «Клиент Instagram». */
export function contactLabel(c: { contactName: string | null; contactUsername: string | null }): string {
  return c.contactName || (c.contactUsername ? `@${c.contactUsername}` : 'Клиент Instagram');
}
