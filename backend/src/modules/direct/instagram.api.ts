import { createHash } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DirectSetting } from './direct.entity';
import { fetchFile, graphRequest, MessengerError, type DownloadedFile } from './meta-http';

/**
 * Единственное место, где CRM ходит в Instagram по сети (тесты подменяют
 * адрес API переменной INSTAGRAM_API_URL).
 *
 * Переменные окружения (Railway → Variables), все или ни одной:
 *   INSTAGRAM_ACCESS_TOKEN — маркер из «Сгенерировать маркеры доступа»;
 *   INSTAGRAM_APP_SECRET   — секрет Instagram-приложения (им подписаны вебхуки);
 *   META_VERIFY_TOKEN      — слово для проверки адреса вебхука.
 * Необязательные: INSTAGRAM_API_URL (по умолчанию graph.instagram.com/v26.0),
 * INSTAGRAM_ACCOUNT_ID (иначе узнаём сами через /me).
 *
 * Маркер живёт 60 дней. CRM сама меняет его на свежий за месяц до конца и
 * хранит в direct_settings, привязав к отпечатку маркера из окружения: если
 * в Railway вписали новый — побеждает он.
 */

const TOKEN_KEY = 'instagram';
const DEFAULT_API_URL = 'https://graph.instagram.com/v26.0';

export interface InstagramProfile {
  name: string | null;
  username: string | null;
  picture: string | null;
}

export interface InstagramState {
  token: string;
  /** Отпечаток маркера из окружения, от которого пошла эта линия. */
  source: string;
  expiresAt: string | null;
  refreshedAt: string | null;
  username: string | null;
  accountId: string | null;
  /** Instagram отказал маркеру: истёк или отозван. Снимается следующим успехом. */
  invalid: boolean;
}

const fingerprint = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 16);

export function instagramEnv() {
  const accessToken = (process.env.INSTAGRAM_ACCESS_TOKEN || '').trim();
  const appSecret = (process.env.INSTAGRAM_APP_SECRET || '').trim();
  const verifyToken = (process.env.META_VERIFY_TOKEN || '').trim();
  const apiUrl = (process.env.INSTAGRAM_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  const accountId = (process.env.INSTAGRAM_ACCOUNT_ID || '').trim() || null;
  return { accessToken, appSecret, verifyToken, apiUrl, accountId, connected: !!(accessToken && appSecret) };
}

@Injectable()
export class InstagramApi {
  constructor(@InjectRepository(DirectSetting) private readonly settings: Repository<DirectSetting>) {}

  get connected(): boolean {
    return instagramEnv().connected;
  }

  /** Состояние подключения; null — Instagram не подключён. */
  async state(): Promise<InstagramState | null> {
    const env = instagramEnv();
    if (!env.connected) return null;
    const row = await this.settings.findOne({ where: { key: TOKEN_KEY } });
    const stored = row?.value as InstagramState | undefined;
    const base: InstagramState = {
      token: env.accessToken, source: fingerprint(env.accessToken), expiresAt: null, refreshedAt: null,
      username: null, accountId: null, invalid: false,
    };
    const state = stored?.source === base.source ? { ...base, ...stored } : base;
    if (env.accountId) state.accountId = env.accountId;
    return state;
  }

  async update(change: Partial<InstagramState>): Promise<void> {
    const current = await this.state();
    if (!current) return;
    await this.settings.save({ key: TOKEN_KEY, value: { ...current, ...change } });
  }

  /** replyTo — mid сообщения, на которое отвечаем (цитата в Instagram). */
  async sendText(recipientId: string, text: string, replyTo?: string | null): Promise<string> {
    return this.sendMessage(recipientId, { text }, replyTo);
  }

  /** Фото, видео, PDF или голосовое. Instagram скачивает файл по ссылке сам. */
  async sendAttachment(recipientId: string, type: 'image' | 'video' | 'file' | 'audio', url: string, replyTo?: string | null): Promise<string> {
    return this.sendMessage(recipientId, { attachment: { type, payload: { url } } }, replyTo);
  }

  /** «Печатает…» у клиента. */
  async typing(recipientId: string): Promise<void> {
    await this.request('me/messages', { method: 'POST', body: { recipient: { id: recipientId }, sender_action: 'typing_on' } });
  }

  /** Реакция ❤️ на сообщение клиента или её снятие. Instagram даёт только «love». */
  async react(recipientId: string, messageId: string, on: boolean): Promise<void> {
    await this.request('me/messages', {
      method: 'POST',
      body: on
        ? { recipient: { id: recipientId }, sender_action: 'react', payload: { message_id: messageId, reaction: 'love' } }
        : { recipient: { id: recipientId }, sender_action: 'unreact', payload: { message_id: messageId } },
    });
  }

  /**
   * Отправка с цитатой: если Instagram не примет поле reply_to (неверный
   * параметр — код 100), сообщение уходит без него: ответ важнее цитаты.
   */
  private async sendMessage(recipientId: string, message: Record<string, unknown>, replyTo?: string | null): Promise<string> {
    const send = (withReply: boolean) => this.request<{ message_id: string }>('me/messages', {
      method: 'POST',
      body: { recipient: { id: recipientId }, message: withReply && replyTo ? { ...message, reply_to: { mid: replyTo } } : message },
    });
    try {
      return (await send(true)).message_id;
    } catch (error) {
      if (!replyTo || !(error instanceof MessengerError) || error.code !== 100) throw error;
      return (await send(false)).message_id;
    }
  }

  async profile(contactId: string): Promise<InstagramProfile> {
    const answer = await this.request<{ name?: string; username?: string; profile_pic?: string }>(encodeURIComponent(contactId), {
      query: { fields: 'name,username,profile_pic' },
    });
    return { name: answer.name || null, username: answer.username || null, picture: answer.profile_pic || null };
  }

  /** Аккаунт агентства: id для вебхуков и имя. Заодно проверка маркера. */
  async me(): Promise<{ accountId: string; username: string }> {
    const answer = await this.request<{ user_id?: string | number; id?: string; username: string }>('me', { query: { fields: 'user_id,username' } });
    return { accountId: String(answer.user_id ?? answer.id), username: answer.username };
  }

  async refreshToken(token: string): Promise<{ token: string; expiresIn: number }> {
    const answer = await this.request<{ access_token: string; expires_in: number }>('refresh_access_token', {
      query: { grant_type: 'ig_refresh_token', access_token: token },
      token,
      root: true,
    });
    return { token: answer.access_token, expiresIn: answer.expires_in };
  }

  async download(url: string, maxBytes: number): Promise<DownloadedFile> {
    return fetchFile(url, maxBytes, new URL(instagramEnv().apiUrl).host);
  }

  private async request<T>(
    path: string,
    { method = 'GET', body, query, token, root = false }: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string>; token?: string; root?: boolean } = {},
  ): Promise<T> {
    const env = instagramEnv();
    if (!env.connected) throw new ConflictException('Instagram не подключён');
    const api = new URL(env.apiUrl);
    // Продление маркера живёт в корне хоста, а не под версией API.
    const url = new URL(root ? `${api.origin}/${path}` : `${env.apiUrl}/${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return graphRequest<T>(url, { method, body, token: token ?? (await this.state())!.token });
  }
}
