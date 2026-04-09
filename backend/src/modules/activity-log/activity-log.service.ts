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
}
