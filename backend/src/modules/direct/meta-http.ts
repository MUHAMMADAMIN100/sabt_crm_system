import { createHmac, timingSafeEqual } from 'crypto';

/** Meta отказала в запросе; код и подкод её ответа говорят почему. Код 0 — сбой сети. */
export class MessengerError extends Error {
  constructor(
    readonly code: number,
    readonly subcode: number | null,
    message: string,
  ) {
    super(message);
  }
}

export interface DownloadedFile {
  bytes: Buffer;
  /** Тип, который назвал сервер. */
  type: string | null;
}

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

/** Серверы Meta, где лежат файлы сообщений. Ничего другого по ссылке из
 *  уведомления не качаем — иначе любой, подделав ссылку, заставил бы
 *  сервер ходить во внутреннюю сеть (SSRF). */
const MEDIA_HOSTS = ['fbcdn.net', 'fbsbx.com', 'cdninstagram.com', 'instagram.com', 'facebook.com'];

/** Ведёт ли ссылка на серверы Meta (или на хост API — заглушку в тестах). */
export function isMediaLink(value: string, apiHost: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.host === apiHost) return true;
  return url.protocol === 'https:' && MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** Скачивает файл сообщения с серверов Meta, не больше `maxBytes`. */
export async function fetchFile(url: string, maxBytes: number, apiHost: string): Promise<DownloadedFile> {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let current = url;
  let response: Response | null = null;
  // Редирект проходим вручную: он тоже обязан вести на серверы Meta.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isMediaLink(current, apiHost)) throw new MessengerError(0, null, 'not a link of Meta');
    response = await fetch(current, { signal, redirect: 'manual' }).catch((error: unknown) => {
      throw new MessengerError(0, null, String(error));
    });
    const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!next) break;
    current = new URL(next, current).href;
    response = null;
  }
  if (!response) throw new MessengerError(0, null, 'too many redirects');
  if (!response.ok) throw new MessengerError(response.status, null, `the file answered ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new MessengerError(413, null, 'the file is too large');

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new MessengerError(413, null, 'the file is too large');
  return { bytes, type: response.headers.get('content-type') };
}

/** Запрос к Graph API: ответ или MessengerError с кодом Meta. Ключ — в
 *  заголовке, не в адресе: адреса попадают в журналы. */
export async function graphRequest<T>(url: URL, init: { method?: 'GET' | 'POST'; token: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${init.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  }).catch((error: unknown) => {
    throw new MessengerError(0, null, String(error));
  });

  const answer = (await response.json().catch(() => ({}))) as T & { error?: { code?: number; error_subcode?: number; message?: string } };
  if (!response.ok || answer.error) {
    const error = answer.error ?? {};
    throw new MessengerError(error.code ?? response.status, error.error_subcode ?? null, error.message ?? `Meta answered ${response.status}`);
  }
  return answer;
}

/** Пришло ли уведомление от Meta: она подписывает сырое тело секретом
 *  приложения, который знают только она и мы. */
export function signedByMeta(body: Buffer | undefined, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !body || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
