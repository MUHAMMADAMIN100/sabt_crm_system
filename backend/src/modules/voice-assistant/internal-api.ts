import { JwtService } from '@nestjs/jwt';

/**
 * Вызов собственного API от имени сотрудника.
 *
 * Почему HTTP, а не прямой вызов сервисов: часть проверок сайта живёт только
 * на входе в API — @RequirePerm, DTO с forbidNonWhitelisted, FinanceAccessGuard,
 * журнал финансов, сброс кэша. Через API бот проходит ровно тот же путь, что
 * и кнопка на сайте, и ничего не теряется.
 *
 * Пропуск (JWT) живёт 2 минуты и наружу не уходит: запрос идёт на 127.0.0.1.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: any) {
    super(message);
  }
}

export interface ApiUser { id: string; email?: string | null; role: string }

export function internalApiBase(): string {
  const explicit = String(process.env.INTERNAL_API_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT || 3000}/api`;
}

export class UserApi {
  private token: string | null = null;
  private tokenAt = 0;

  constructor(
    private readonly jwt: JwtService,
    readonly user: ApiUser,
    private readonly base = internalApiBase(),
    /** Подмена транспорта в тестах. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private bearer(): string {
    // Новый пропуск раз в минуту: одна команда укладывается, а старый
    // пропуск не успевает истечь посреди цепочки запросов.
    if (!this.token || Date.now() - this.tokenAt > 60_000) {
      this.token = this.jwt.sign(
        { sub: this.user.id, email: this.user.email || '', role: this.user.role },
        { expiresIn: '2m' },
      );
      this.tokenAt = Date.now();
    }
    return this.token;
  }

  get<T = any>(path: string, query?: Record<string, any>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }
  post<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  patch<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('PATCH', path, body ?? {});
  }
  delete<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  async request<T>(method: string, path: string, body?: any, query?: Record<string, any>): Promise<T> {
    const qs = query
      ? '?' + Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
      : '';
    const url = `${this.base}${path.startsWith('/') ? path : `/${path}`}${qs === '?' ? '' : qs}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.bearer()}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': 'SabtTelegramVoice/1.0',
          'X-Sabt-Client': 'telegram-voice',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: any) {
      throw new ApiError(0, `Сервер CRM не ответил: ${e?.message || e}`);
    }
    const text = await res.text();
    let data: any = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) throw new ApiError(res.status, humanApiMessage(res.status, data), data);
    return data as T;
  }
}

/** Сообщение ошибки так, как его показал бы сайт. */
export function humanApiMessage(status: number, data: any): string {
  const m = data && typeof data === 'object' ? data.message : data;
  const text = Array.isArray(m) ? m.join('; ') : (typeof m === 'string' ? m : '');
  if (status === 403) {
    return text && !/^Forbidden( resource)?$/i.test(text) ? text : 'Недостаточно прав для этого действия';
  }
  if (status === 404) return text && !/^Not Found$/i.test(text) ? text : 'Не найдено';
  if (status === 401) return 'Сессия бота не принята сервером';
  if (status === 429) return 'Слишком много запросов — повторите через минуту';
  if (status >= 500) return 'Ошибка на сервере CRM';
  return text || `Ошибка ${status}`;
}
