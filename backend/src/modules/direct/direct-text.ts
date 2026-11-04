import { MessengerError } from './meta-http';
import type { DirectAttachmentKind } from './direct.entity';

/** Instagram принимает до 1000 байт текста в одном сообщении: около 500 русских букв. */
export const MAX_TEXT_BYTES = 1000;
/** Сколько знаков сотрудник может отправить за раз — дальше делим на сообщения. */
export const MAX_COMPOSE_CHARS = 4000;
/** Ответить из CRM можно в течение суток после последнего сообщения клиента. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Режет текст на сообщения, которые примет Instagram. Часть заканчивается на
 * переносе строки или пробеле рядом с пределом, чтобы не резать слово; слово
 * длиннее предела режется где придётся. Эмодзи пополам не режется.
 */
export function splitText(input: string, maxBytes: number = MAX_TEXT_BYTES): string[] {
  const parts: string[] = [];
  let rest = input.trim();

  while (Buffer.byteLength(rest) > maxBytes) {
    let fits = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = Buffer.byteLength(char);
      if (bytes + size > maxBytes) break;
      bytes += size;
      fits += char.length;
    }
    const head = rest.slice(0, fits);
    const gap = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
    // Пробел в первой половине оставил бы огрызок — режем по пределу.
    const end = gap > fits / 2 ? gap : fits;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/** До какого момента можно ответить из CRM; null — клиент ещё не писал. */
export function replyUntil(conversation: { lastIncomingAt: Date | null }): Date | null {
  return conversation.lastIncomingAt ? new Date(new Date(conversation.lastIncomingAt).getTime() + REPLY_WINDOW_MS) : null;
}

/**
 * Почему Instagram не принял сообщение — код, который CRM переводит для людей:
 *   TOKEN_INVALID — ключ недействителен;
 *   WINDOW_CLOSED — прошло 24 часа после последнего сообщения клиента;
 *   UNAVAILABLE   — клиент заблокировал аккаунт или удалил свой;
 *   NETWORK       — сбой связи, можно повторить;
 *   REJECTED      — Meta отказала по другой причине.
 */
export function failureOf(error: unknown): string {
  if (!(error instanceof MessengerError)) return 'REJECTED';
  if (error.code === 0) return 'NETWORK';
  if (error.code === 190) return 'TOKEN_INVALID';
  if (error.code === 10 && error.subcode === 2534022) return 'WINDOW_CLOSED';
  if (error.code === 551 || error.subcode === 2534014 || error.subcode === 2018001) return 'UNAVAILABLE';
  if (error.code === 2 || error.code === 1 || error.code === 4 || error.code === 613) return 'NETWORK';
  return 'REJECTED';
}

const KIND_LABELS: Record<DirectAttachmentKind, string> = {
  image: 'Фото',
  video: 'Видео',
  audio: 'Голосовое сообщение',
  file: 'Файл',
  sticker: 'Стикер',
  share: 'Публикация',
  reel: 'Reels',
  story: 'Сторис',
  unsupported: 'Сообщение',
};

/** Короткое описание сообщения для списка чатов и уведомлений. */
export function messagePreview(message: { text: string | null; deletedAt?: Date | null }, kinds: DirectAttachmentKind[]): string {
  if (message.deletedAt) return 'Сообщение удалено';
  const words = (message.text || '').replace(/\s+/g, ' ').trim();
  if (words) return words.length > 140 ? `${words.slice(0, 139)}…` : words;
  return kinds.length ? KIND_LABELS[kinds[0]] : 'Сообщение';
}
