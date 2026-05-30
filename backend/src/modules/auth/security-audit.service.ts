import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { SecurityEvent, SecurityEventType } from './security-event.entity';
import type { Request } from 'express';

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

  /** Сколько неуспешных логинов с IP за последние N минут — для rate-limit логики
   *  и для предупреждения «возможный bruteforce». */
  async failsFromIpRecent(ip: string, minutes = 15): Promise<number> {
    if (!ip) return 0;
    const since = new Date(Date.now() - minutes * 60_000);
    return this.repo.count({
      where: {
        ip,
        type: SecurityEventType.LOGIN_FAIL,
        createdAt: LessThan(new Date()) as any,
      },
    }).then(async () => {
      // Считаем точно с фильтром createdAt > since
      return this.repo
        .createQueryBuilder('e')
        .where('e.ip = :ip', { ip })
        .andWhere('e.type = :t', { t: SecurityEventType.LOGIN_FAIL })
        .andWhere('e.createdAt > :since', { since })
        .getCount();
    });
  }

  /** Берём IP из стандартных мест: X-Forwarded-For (Vercel/Railway), X-Real-IP,
   *  socket.remoteAddress. */
  private extractIp(req: Request): string | null {
    const xff = (req.headers['x-forwarded-for'] as string) || '';
    if (xff) return xff.split(',')[0].trim();
    const xri = req.headers['x-real-ip'];
    if (xri) return String(xri);
    return req.socket?.remoteAddress || null;
  }
}
