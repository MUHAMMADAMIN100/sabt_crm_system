import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContentPlanItem,
  ContentPlanStatus,
  ContentApprovalStatus,
  ContentItemType,
} from './content-plan-item.entity';

export interface ContentPlanFilters {
  projectId?: string;
  status?: ContentPlanStatus;
  approvalStatus?: ContentApprovalStatus;
  assigneeId?: string;
  contentType?: ContentItemType;
  from?: string;  // YYYY-MM-DD — нижняя граница publishDate
  to?: string;    // YYYY-MM-DD — верхняя граница publishDate
}

@Injectable()
export class ContentPlanService {
  constructor(
    @InjectRepository(ContentPlanItem) private repo: Repository<ContentPlanItem>,
  ) {}

  async findAll(f: ContentPlanFilters = {}) {
    const qb = this.repo.createQueryBuilder('c')
      .leftJoinAndSelect('c.assignee', 'assignee')
      .leftJoinAndSelect('c.pm', 'pm')
      .leftJoinAndSelect('c.project', 'project');

    if (f.projectId) qb.andWhere('c.projectId = :pid', { pid: f.projectId });
    if (f.status) qb.andWhere('c.status = :st', { st: f.status });
    if (f.approvalStatus) qb.andWhere('c.approvalStatus = :ast', { ast: f.approvalStatus });
    if (f.assigneeId) qb.andWhere('c.assigneeId = :aid', { aid: f.assigneeId });
    if (f.contentType) qb.andWhere('c.contentType = :ct', { ct: f.contentType });
    if (f.from) qb.andWhere('c.publishDate >= :from', { from: f.from });
    if (f.to) qb.andWhere('c.publishDate <= :to', { to: f.to });

    qb.orderBy('c.publishDate', 'ASC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({
      where: { id },
      relations: ['assignee', 'pm', 'project'],
    });
    if (!item) throw new NotFoundException('Content plan item not found');
    return item;
  }

  async create(dto: Partial<ContentPlanItem>) {
    const item = this.repo.create(dto);
    return this.repo.save(item);
  }

  /** Массовое создание — нужно для авто-генерации плана из тарифа. */
  async createMany(items: Partial<ContentPlanItem>[]) {
    if (!items.length) return [];
    const entities = items.map(d => this.repo.create(d));
    return this.repo.save(entities);
  }

  async update(id: string, dto: Partial<ContentPlanItem>) {
    await this.findOne(id);
    const { id: _id, createdAt, updatedAt, ...patch } = dto as any;
    await this.repo.update(id, patch);
    return this.findOne(id);
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { message: 'Content plan item deleted' };
  }

  /** План-факт по проекту: сколько чего запланировано vs опубликовано.
   *  Используется в Wave 5 (план-факт) и в риск-скоринге. */
  async getPlanFactByProject(projectId: string) {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.contentType', 'contentType')
      .addSelect('COUNT(*)', 'planned')
      .addSelect(`SUM(CASE WHEN c.status = 'published' THEN 1 ELSE 0 END)`, 'published')
      .addSelect(`SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END)`, 'cancelled')
      .where('c.projectId = :pid', { pid: projectId })
      .groupBy('c.contentType')
      .getRawMany();

    return rows.map(r => ({
      contentType: r.contentType,
      planned: Number(r.planned),
      published: Number(r.published),
      cancelled: Number(r.cancelled),
      remaining: Math.max(0, Number(r.planned) - Number(r.published) - Number(r.cancelled)),
    }));
  }
}
