import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog, ActivityAction } from './activity-log.entity';

export interface LogDto {
  userId?: string;
  userName?: string;
  action: ActivityAction;
  entity?: string;
  entityId?: string;
  entityName?: string;
  details?: Record<string, any>;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectRepository(ActivityLog)
    private repo: Repository<ActivityLog>,
  ) {}

  async log(dto: LogDto): Promise<void> {
    try {
      const entry = this.repo.create(dto);
      await this.repo.save(entry);
    } catch (e) {
      this.logger.warn(`Activity log failed: ${e?.message || e}`);
    }
  }

  async findAll(filters: {
    userId?: string;
    action?: ActivityAction;
    entity?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const qb = this.repo.createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'user')
      .orderBy('a.createdAt', 'DESC');

    if (filters.userId)  qb.andWhere('a.userId = :userId', { userId: filters.userId });
    if (filters.action)  qb.andWhere('a.action = :action', { action: filters.action });
    if (filters.entity)  qb.andWhere('a.entity = :entity', { entity: filters.entity });
    if (filters.from)    qb.andWhere('a.createdAt >= :from', { from: filters.from });
    if (filters.to)      qb.andWhere('a.createdAt <= :to', { to: filters.to });

    const limit  = Math.max(1, Math.min(100, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);
    qb.take(limit).skip(offset);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Единая лента активности КОМАНДЫ для основателя: объединяет общий журнал
   * (activity_logs) и финансовый (finance_activity), чтобы в одном месте было
   * видно, что делает каждый сотрудник — включая финансовые действия
   * сооснователя, которых в обычной ленте сотрудника нет.
   *
   * Возвращает нормализованные строки с признаком source ('general'|'finance');
   * человекочитаемые ярлыки/детали формирует фронтенд.
   */
  async teamFeed(filters: {
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit  = Math.max(1, Math.min(100, Number(filters.limit) || 40));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const userId = filters.userId || null;
    const from   = filters.from || null;
    const to     = filters.to || null;

    // Тянем limit+1, чтобы понять, есть ли ещё («Показать ещё») без COUNT.
    const rows: any[] = await this.repo.manager.query(
      `SELECT id, source, "userId", "userName", "userAvatar", "userRole",
              action, entity, "entityId", "entityName", route, details, "createdAt"
       FROM (
         SELECT a.id::text AS id, 'general'::text AS source, a."userId"::text AS "userId",
                u.name AS "userName", u.avatar AS "userAvatar", u.role::text AS "userRole",
                a.action::text AS action, a.entity::text AS entity,
                a."entityId"::text AS "entityId", a."entityName"::text AS "entityName",
                NULL::text AS route, a.details AS details,
                a."createdAt"::timestamptz AS "createdAt"
         FROM activity_logs a
         LEFT JOIN users u ON u.id = a."userId"
         UNION ALL
         SELECT f.id::text, 'finance'::text, f."userId"::text,
                u.name, u.avatar, u.role::text,
                f.action::text, NULL::text, NULL::text, NULL::text,
                f.route::text, f.details, f."createdAt"::timestamptz
         FROM finance_activity f
         LEFT JOIN users u ON u.id = f."userId"
       ) t
       WHERE ($1::text IS NULL OR t."userId" = $1)
         AND ($2::timestamptz IS NULL OR t."createdAt" >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR t."createdAt" <= $3::timestamptz)
       ORDER BY t."createdAt" DESC
       LIMIT $4 OFFSET $5`,
      [userId, from, to, limit + 1, offset],
    ).catch((e: any) => {
      this.logger.warn(`teamFeed failed: ${e?.message || e}`);
      return [];
    });

    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore, offset, limit };
  }
}
