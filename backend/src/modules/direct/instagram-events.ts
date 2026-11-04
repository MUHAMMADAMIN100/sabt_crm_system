import type { DirectAttachmentKind } from './direct.entity';

/**
 * Разбор уведомлений Instagram в общие события. Остальной код не знает
 * конвертов Meta: только «сообщение», «удалено», «реакция», «прочитано».
 * Образец — рабочая интеграция Rangorang (c:\temp\meta-messengers-integration.md).
 */

export interface IncomingAttachment {
  kind: DirectAttachmentKind;
  /** Файл или страница публикации. Ссылки Instagram на файлы живут несколько дней. */
  url: string | null;
  /** Подпись к публикации, если Instagram её прислал. */
  title: string | null;
}

interface EventBase {
  /** Аккаунт агентства (entry.id). */
  accountId: string;
  /** Собеседник — другая сторона переписки. */
  contactId: string;
}

export type DirectEvent =
  | (EventBase & {
      kind: 'message';
      /** Написало агентство: из CRM или прямо в приложении Instagram (эхо). */
      outgoing: boolean;
      externalId: string;
      sentAt: Date;
      text: string | null;
      attachments: IncomingAttachment[];
      replyToId: string | null;
    })
  | (EventBase & { kind: 'deleted'; externalId: string })
  | (EventBase & {
      kind: 'reaction';
      externalId: string;
      /** null — реакцию сняли. */
      emoji: string | null;
      /** Реакцию поставил клиент; свои реакции агентства не храним. */
      byContact: boolean;
    })
  | (EventBase & { kind: 'read'; externalId: string });

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const id = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number' ? String(value) : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Ссылка, которую CRM может показать: только веб-адрес, не скрипт. */
export const link = (value: unknown): string | null => {
  const candidate = text(value);
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : null;
};

const ATTACHMENT_KINDS: Record<string, DirectAttachmentKind> = {
  image: 'image',
  animated_image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  sticker: 'sticker',
  share: 'share',
  ig_post: 'share',
  reel: 'reel',
  ig_reel: 'reel',
  story_mention: 'story',
};

const linked = (kind: DirectAttachmentKind, url: string | null, title: string | null = null): IncomingAttachment => ({ kind, url, title });

function toAttachment(raw: unknown): IncomingAttachment | null {
  if (!isObject(raw)) return null;
  const payload = isObject(raw.payload) ? raw.payload : {};
  return linked(ATTACHMENT_KINDS[String(raw.type)] ?? 'unsupported', link(payload.url), text(payload.title));
}

function messageEvent(base: EventBase, outgoing: boolean, timestamp: unknown, message: Json): DirectEvent | null {
  const externalId = id(message.mid);
  if (!externalId) return null;
  if (message.is_deleted === true) return { ...base, kind: 'deleted', externalId };

  const attachments = list(message.attachments)
    .map(toAttachment)
    .filter((attachment): attachment is IncomingAttachment => attachment !== null);
  const replyTo = isObject(message.reply_to) ? message.reply_to : null;
  // Ответ на сторис агентства несёт саму сторис — показываем, на что ответили.
  const story = replyTo && isObject(replyTo.story) ? replyTo.story : null;
  if (story) attachments.unshift(linked('story', link(story.url)));
  if (message.is_unsupported === true && !attachments.length) attachments.push(linked('unsupported', null));

  return {
    ...base,
    kind: 'message',
    outgoing,
    externalId,
    sentAt: new Date(typeof timestamp === 'number' ? timestamp : Date.now()),
    text: text(message.text),
    attachments,
    replyToId: replyTo ? id(replyTo.mid) : null,
  };
}

/** Один элемент `messaging`: кто кому написал и что произошло. */
function toEvent(accountId: string, raw: unknown): DirectEvent | null {
  if (!isObject(raw)) return null;
  const sender = isObject(raw.sender) ? id(raw.sender.id) : null;
  const recipient = isObject(raw.recipient) ? id(raw.recipient.id) : null;
  if (!sender || !recipient) return null;

  // Эхо — то, что написало само агентство: переписка — с получателем.
  const message = isObject(raw.message) ? raw.message : null;
  const outgoing = message?.is_echo === true || sender === accountId;
  const base: EventBase = { accountId, contactId: outgoing ? recipient : sender };

  if (message) return messageEvent(base, outgoing, raw.timestamp, message);

  if (isObject(raw.postback)) {
    // Нажатие на кнопку читается в переписке как слова кнопки.
    const { mid, title } = raw.postback;
    return messageEvent(base, false, raw.timestamp, { mid, text: title });
  }

  if (isObject(raw.reaction)) {
    const externalId = id(raw.reaction.mid);
    if (!externalId) return null;
    const removed = raw.reaction.action === 'unreact';
    return { ...base, kind: 'reaction', externalId, emoji: removed ? null : (text(raw.reaction.emoji) ?? '❤️'), byContact: !outgoing };
  }

  if (isObject(raw.read)) {
    const externalId = id(raw.read.mid);
    return externalId && !outgoing ? { ...base, kind: 'read', externalId } : null;
  }

  return null;
}

/** Поля `changes`, которые несут то же, что `messaging`. */
const MESSAGING_FIELDS = new Set(['messages', 'message_reactions', 'messaging_seen', 'messaging_postbacks', 'message_edit']);

/** Обычно Instagram кладёт события в `messaging`; кнопка «Тестировать» в
 *  кабинете Meta (и, по опыту разработчиков, часть доставок) — в `changes`. */
function messagingOf(entry: Json): unknown[] {
  const changed = list(entry.changes).flatMap((change) =>
    isObject(change) && MESSAGING_FIELDS.has(String(change.field)) && isObject(change.value) ? [change.value] : [],
  );
  return [...list(entry.messaging), ...changed];
}

/** События уведомления Instagram. Комментарии, рефералы и неизвестное
 *  пропускаем; битый элемент не портит остальные. */
export function parseInstagramWebhook(body: unknown): DirectEvent[] {
  if (!isObject(body) || body.object !== 'instagram') return [];
  return list(body.entry).flatMap((entry) => {
    if (!isObject(entry)) return [];
    const accountId = id(entry.id);
    if (!accountId) return [];
    return messagingOf(entry)
      .map((raw) => toEvent(accountId, raw))
      .filter((event): event is DirectEvent => event !== null);
  });
}

/** Из чего состоит уведомление — без единого слова клиента. Для журнала,
 *  когда CRM ничего в нём не нашла. */
export function describeWebhook(body: unknown): string {
  if (!isObject(body)) return `not an object (${typeof body})`;
  const entries = list(body.entry).filter(isObject);
  const keys = [...new Set(entries.flatMap((entry) => Object.keys(entry)))].sort().join(',');
  const changes = entries.flatMap((entry) => list(entry.changes).filter(isObject));
  const fields = [...new Set(changes.map((change) => String(change.field)))].join(',');
  const kinds = [
    ...new Set(entries.flatMap((entry) => list(entry.messaging).flatMap((raw) => (isObject(raw) ? Object.keys(raw).filter((key) => !['sender', 'recipient', 'timestamp'].includes(key)) : [])))),
  ].join(',');
  return `object=${String(body.object)} entries=${entries.length} keys=${keys || '-'} changes=${fields || '-'} messaging=${kinds || '-'}`;
}
