import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityEvent, SecurityEventType } from './security-event.entity';
import type { Request } from 'express';
import { impersonationStore } from './impersonation';

/**
 * Сервис журнала безопасности. Не валит запрос если запись не пишется —
 * security log должен быть best-effort, иначе DoS на самой БД может
 * заблокировать логин/выход.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger('SecurityAudit');

  constructor(
    @InjectRepository(SecurityEvent) private repo: Repository<SecurityEvent>,
  ) {}

  async log(params: {
    type: SecurityEventType;
    userId?: string | null;
    email?: string | null;
    req?: Request | null;
    details?: Record<string, any>;
  }) {
    // «Войти как» не оставляет следов (решение владельца 13.11.2026): то, что
    // основатель/админ делает из кабинета сотрудника, в журнал не пишем —
    // иначе сотрудник «попытался бы войти выше роли», хотя это был не он.
    if ((params.req as any)?.user?.impersonatorId || impersonationStore.getStore()) return;
    try {
      const ip = params.req ? this.extractIp(params.req) : null;
      const userAgent = params.req?.headers?.['user-agent']?.toString().slice(0, 500) || null;
      await this.repo.save(this.repo.create({
        type: params.type,
        userId: params.userId ?? null,
        email: params.email ?? null,
        ip,
        userAgent,
        details: params.details ?? null,
      }));
    } catch (e: any) {
      this.logger.warn(`failed to write security event: ${e?.message}`);
    }
  }

  /** Список событий с фильтрами для админ-страницы. */
  async list(filters: {
    type?: SecurityEventType;
    userId?: string;
    email?: string;
    ip?: string;
    limit?: number;
  } = {}) {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.createdAt', 'DESC');
    if (filters.type) qb.andWhere('e.type = :t', { t: filters.type });
    if (filters.userId) qb.andWhere('e.userId = :u', { u: filters.userId });
    if (filters.email) qb.andWhere('e.email ILIKE :em', { em: `%${filters.email}%` });
    if (filters.ip) qb.andWhere('e.ip = :ip', { ip: filters.ip });
    qb.take(Math.min(500, Math.max(1, filters.limit ?? 100)));
    return qb.getMany();
  }

  /** Что считается неудачной попыткой входа. Неверный код 2FA — тоже
   *  (15.11.2026): иначе, зная пароль, код перебирали без ограничений. */
  private static readonly FAIL_TYPES = [SecurityEventType.LOGIN_FAIL, SecurityEventType.TWO_FACTOR_FAIL];

  /** Сколько неуспешных логинов с этого IP за последние N минут. */
  async failsFromIpRecent(ip: string | null, minutes = 15): Promise<number> {
    if (!ip) return 0;
    const since = new Date(Date.now() - minutes * 60_000);
    return this.repo
      .createQueryBuilder('e')
      .where('e.ip = :ip', { ip })
      .andWhere('e.type IN (:...types)', { types: SecurityAuditService.FAIL_TYPES })
      .andWhere('e.createdAt > :since', { since })
      .getCount();
  }

  /** Сколько неуспешных логинов на этот email за последние N минут.
   *  Без учёта регистра (15.11.2026): «Ivan@x.tj» и «ivan@x.tj» — один
   *  аккаунт, а раньше каждый вариант написания давал свои 5 попыток. */
  async failsForEmailRecent(email: string | null, minutes = 15): Promise<number> {
    const key = (email || '').trim().toLowerCase();
    if (!key) return 0;
    const since = new Date(Date.now() - minutes * 60_000);
    return this.repo
      .createQueryBuilder('e')
      .where('LOWER(e.email) = :em', { em: key })
      .andWhere('e.type IN (:...types)', { types: SecurityAuditService.FAIL_TYPES })
      .andWhere('e.createdAt > :since', { since })
      .getCount();
  }

  /** Проверяем lockout: достигнуты ли пороги по email или IP за 15 минут.
   *  Пороги — компромисс между UX (опечатки пароля) и защитой от bruteforce:
   *   - 5 неудач на один email
   *   - 20 неудач с одного IP (учитывает попытки по нескольким аккаунтам)
   *  Возвращает { locked, by, retryAfterSec }. */
  async checkLoginLockout(email: string | null, ip: string | null) {
    const [byEmail, byIp] = await Promise.all([
      this.failsForEmailRecent(email, 15),
      this.failsFromIpRecent(ip, 15),
    ]);
    if (byEmail >= 5) return { locked: true as const, by: 'email' as const, count: byEmail, retryAfterSec: 15 * 60 };
    if (byIp >= 20)   return { locked: true as const, by: 'ip' as const,    count: byIp,    retryAfterSec: 15 * 60 };
    return { locked: false as const };
  }

  /** IP клиента — req.ip (15.11.2026). main.ts ставит `trust proxy 1`, и
   *  Express сам берёт адрес, который дописал наш прокси. Самый левый
   *  X-Forwarded-For присылает сам клиент: подставляя туда случайный адрес,
   *  он обходил блокировку по IP и писал в журнал чужие адреса. */
  private extractIp(req: Request): string | null {
    return req.ip || req.socket?.remoteAddress || null;
  }
}
