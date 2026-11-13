import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DirectSetting } from './direct.entity';
import { fetchFile, graphRequest, MessengerError, type DownloadedFile } from './meta-http';

/**
 * Единственное место, где CRM ходит в Instagram по сети (тесты подменяют
 * адрес API переменной INSTAGRAM_API_URL).
 *
 * Переменные окружения (Railway → Variables):
 *   INSTAGRAM_APP_SECRET   — секрет Instagram-приложения (им подписаны вебхуки);
 *   META_VERIFY_TOKEN      — слово для проверки адреса вебхука;
 *   INSTAGRAM_ACCESS_TOKEN — маркер ОСНОВНОГО аккаунта (@webrand.tj).
 * Необязательные: INSTAGRAM_API_URL (по умолчанию graph.instagram.com/v26.0),
 * INSTAGRAM_ACCOUNT_ID (иначе узнаём сами через /me).
 *
 * Аккаунтов может быть несколько (13.11.2026): основной — из окружения,
 * остальные руководство подключает в CRM, вставив маркер из кабинета Meta.
 * Все — в одном приложении Meta: вебхук и секрет общие, у каждого аккаунта
 * свой маркер. Маркеры дополнительных аккаунтов лежат в direct_settings
 * (ключ instagram:<id аккаунта>) зашифрованными.
 *
 * Маркер живёт 60 дней. CRM сама меняет его на свежий за месяц до конца.
 * Основной привязан к отпечатку маркера из окружения: если в Railway вписали
 * новый — побеждает он.
 */

const PRIMARY_KEY = 'instagram';
const EXTRA_PREFIX = 'instagram:';
const DEFAULT_API_URL = 'https://graph.instagram.com/v26.0';
/** Какие события Instagram присылает на вебхук по подключённому аккаунту. */
const WEBHOOK_FIELDS = 'messages,message_reactions,messaging_seen,messaging_postbacks';
/** Список аккаунтов читаем из базы не чаще раза в 15 секунд. */
const ACCOUNTS_TTL_MS = 15_000;

export interface InstagramProfile {
  name: string | null;
  username: string | null;
  picture: string | null;
}

export interface InstagramState {
  token: string;
  /** Отпечаток маркера из окружения, от которого пошла эта линия ('crm' — подключён в CRM). */
  source: string;
  expiresAt: string | null;
  refreshedAt: string | null;
  username: string | null;
  accountId: string | null;
  /** Instagram отказал маркеру: истёк или отозван. Снимается следующим успехом. */
  invalid: boolean;
}

/** Аккаунт, через который идёт переписка. */
export interface InstagramAccount extends InstagramState {
  /** Ключ в direct_settings. */
  key: string;
  /** Основной — из Railway; остальные подключены в CRM. */
  primary: boolean;
  connectedAt?: string | null;
  connectedBy?: string | null;
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

/** Маркер дополнительного аккаунта в базе — зашифрован ключом от JWT_SECRET:
 *  утечка дампа базы не отдаёт доступ к переписке. */
const tokenKey = () => createHash('sha256').update(`direct-token:${process.env.JWT_SECRET || ''}`).digest();

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // JWT_SECRET сменили — маркер не прочитать, аккаунт надо переподключить.
    return null;
  }
}

@Injectable()
export class InstagramApi {
  private cache: { at: number; list: InstagramAccount[] } | null = null;

  constructor(@InjectRepository(DirectSetting) private readonly settings: Repository<DirectSetting>) {}

  /** Основной аккаунт задан в Railway. */
  get connected(): boolean {
    return instagramEnv().connected;
  }

  /** Состояние основного аккаунта; null — он не задан в окружении. */
  async state(): Promise<InstagramState | null> {
    const env = instagramEnv();
    if (!env.connected) return null;
    const row = await this.settings.findOne({ where: { key: PRIMARY_KEY } });
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
    await this.settings.save({ key: PRIMARY_KEY, value: { ...current, ...change } });
    this.cache = null;
  }

  /** Все аккаунты: основной (если задан) и подключённые в CRM. Без секрета
   *  приложения вебхуки не проверить — тогда аккаунтов нет. */
  async accounts(fresh = false): Promise<InstagramAccount[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < ACCOUNTS_TTL_MS) return this.cache.list;
    const list: InstagramAccount[] = [];
    if (instagramEnv().appSecret) {
      const primary = await this.state();
      if (primary) list.push({ ...primary, key: PRIMARY_KEY, primary: true });
      const rows = await this.settings.createQueryBuilder('s').where('s.key LIKE :p', { p: `${EXTRA_PREFIX}%` }).orderBy('s.key').getMany();
      for (const row of rows) {
        const v = row.value ?? {};
        const token = openToken(v.tokenSealed);
        list.push({
          key: row.key, primary: false, token: token ?? '', source: 'crm',
          expiresAt: v.expiresAt ?? null, refreshedAt: v.refreshedAt ?? null, username: v.username ?? null,
          accountId: v.accountId ?? row.key.slice(EXTRA_PREFIX.length), invalid: !token || !!v.invalid,
          connectedAt: v.connectedAt ?? null, connectedBy: v.connectedBy ?? null,
        });
      }
    }
    this.cache = { at: Date.now(), list };
    return list;
  }

  /** Аккаунт переписки. Основной, ещё не узнавший свой id, отвечает за всё,
   *  что не принадлежит дополнительным. */
  async account(accountId: string | null | undefined): Promise<InstagramAccount | null> {
    const list = await this.accounts();
    return list.find(a => a.accountId === accountId)
      ?? list.find(a => a.primary && !a.accountId && !list.some(b => b.accountId === accountId))
      ?? null;
  }

  async updateAccount(account: Pick<InstagramAccount, 'key' | 'primary'>, change: Partial<InstagramState>): Promise<void> {
    if (account.primary) return this.update(change);
    const row = await this.settings.findOne({ where: { key: account.key } });
    if (!row) return;
    const { token, ...rest } = change;
    const value = { ...row.value, ...rest, ...(token ? { tokenSealed: sealToken(token) } : {}) };
    await this.settings.save({ key: account.key, value });
    this.cache = null;
  }

  /**
   * Подключить аккаунт по маркеру из кабинета Meta: кто это, подписка на
   * вебхуки, запись. Тот же аккаунт ещё раз — маркер обновляется.
   */
  async connect(token: string, by: string): Promise<{ account: InstagramAccount; webhooks: boolean; webhookError: string | null; renewed: boolean }> {
    const me = await this.me(token);
    const list = await this.accounts(true);
    const primary = list.find(a => a.primary);
    if (primary && (primary.accountId === me.accountId || (!primary.accountId && primary.username === me.username))) {
      throw new ConflictException(`@${me.username} — основной аккаунт, он уже подключён (маркер — в Railway)`);
    }
    const key = `${EXTRA_PREFIX}${me.accountId}`;
    const existing = list.find(a => a.key === key);
    let webhookError: string | null = null;
    try {
      await this.request('me/subscribed_apps', { method: 'POST', query: { subscribed_fields: WEBHOOK_FIELDS }, token });
    } catch (error) {
      webhookError = error instanceof MessengerError ? error.message : String(error);
    }
    const now = new Date().toISOString();
    await this.settings.save({
      key,
      value: {
        accountId: me.accountId, username: me.username, tokenSealed: sealToken(token), invalid: false,
        // Маркер младше суток Instagram не продлевает — первая попытка через сутки.
        refreshedAt: now, expiresAt: existing?.expiresAt ?? null,
        connectedAt: existing?.connectedAt ?? now, connectedBy: existing?.connectedBy ?? by,
      },
    });
    this.cache = null;
    const account = (await this.accounts(true)).find(a => a.key === key)!;
    return { account, webhooks: !webhookError, webhookError, renewed: !!existing };
  }

  /** Отключить дополнительный аккаунт: переписка остаётся, писать нельзя. */
  async disconnect(accountId: string): Promise<boolean> {
    const res = await this.settings.delete({ key: `${EXTRA_PREFIX}${accountId}` });
    this.cache = null;
    return !!res.affected;
  }

  /** replyTo — mid сообщения, на которое отвечаем (цитата в Instagram). */
  async sendText(account: InstagramAccount, recipientId: string, text: string, replyTo?: string | null): Promise<string> {
    return this.sendMessage(account, recipientId, { text }, replyTo);
  }

  /** Фото, видео, PDF или голосовое. Instagram скачивает файл по ссылке сам. */
  async sendAttachment(account: InstagramAccount, recipientId: string, type: 'image' | 'video' | 'file' | 'audio', url: string, replyTo?: string | null): Promise<string> {
    return this.sendMessage(account, recipientId, { attachment: { type, payload: { url } } }, replyTo);
  }

  /** «Печатает…» у клиента. */
  async typing(account: InstagramAccount, recipientId: string): Promise<void> {
    await this.request('me/messages', { method: 'POST', body: { recipient: { id: recipientId }, sender_action: 'typing_on' }, token: account.token });
  }

  /** Реакция ❤️ на сообщение клиента или её снятие. Instagram даёт только «love». */
  async react(account: InstagramAccount, recipientId: string, messageId: string, on: boolean): Promise<void> {
    await this.request('me/messages', {
      method: 'POST',
      token: account.token,
      body: on
        ? { recipient: { id: recipientId }, sender_action: 'react', payload: { message_id: messageId, reaction: 'love' } }
        : { recipient: { id: recipientId }, sender_action: 'unreact', payload: { message_id: messageId } },
    });
  }

  /**
   * Отправка с цитатой: если Instagram не примет поле reply_to (неверный
   * параметр — код 100), сообщение уходит без него: ответ важнее цитаты.
   */
  private async sendMessage(account: InstagramAccount, recipientId: string, message: Record<string, unknown>, replyTo?: string | null): Promise<string> {
    const send = (withReply: boolean) => this.request<{ message_id: string }>('me/messages', {
      method: 'POST',
      token: account.token,
      body: { recipient: { id: recipientId }, message: withReply && replyTo ? { ...message, reply_to: { mid: replyTo } } : message },
    });
    try {
      return (await send(true)).message_id;
    } catch (error) {
      if (!replyTo || !(error instanceof MessengerError) || error.code !== 100) throw error;
      return (await send(false)).message_id;
    }
  }

  async profile(account: InstagramAccount, contactId: string): Promise<InstagramProfile> {
    const answer = await this.request<{ name?: string; username?: string; profile_pic?: string }>(encodeURIComponent(contactId), {
      query: { fields: 'name,username,profile_pic' },
      token: account.token,
    });
    return { name: answer.name || null, username: answer.username || null, picture: answer.profile_pic || null };
  }

  /** Чей это маркер: id для вебхуков и имя. Заодно проверка маркера. */
  async me(token?: string): Promise<{ accountId: string; username: string }> {
    const answer = await this.request<{ user_id?: string | number; id?: string; username: string }>('me', { query: { fields: 'user_id,username' }, token });
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
    if (!env.appSecret) throw new ConflictException('Instagram не подключён: в Railway нет INSTAGRAM_APP_SECRET');
    const key = token ?? (await this.state())?.token;
    if (!key) throw new ConflictException('Instagram не подключён');
    const api = new URL(env.apiUrl);
    // Продление маркера живёт в корне хоста, а не под версией API.
    const url = new URL(root ? `${api.origin}/${path}` : `${env.apiUrl}/${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return graphRequest<T>(url, { method, body, token: key });
  }
}
