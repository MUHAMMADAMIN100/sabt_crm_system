import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmmTariff } from './smm-tariff.entity';

export interface ListFilters {
  search?: string;
  isActive?: boolean;
}

@Injectable()
export class SmmTariffsService {
  constructor(
    @InjectRepository(SmmTariff) private repo: Repository<SmmTariff>,
  ) {}

  async findAll(f: ListFilters = {}) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.createdBy', 'createdBy');
    if (f.search) {
      qb.andWhere('(t.name ILIKE :s OR t.description ILIKE :s)', { s: `%${f.search}%` });
    }
    if (typeof f.isActive === 'boolean') {
      qb.andWhere('t.isActive = :a', { a: f.isActive });
    }
    qb.orderBy('t.isActive', 'DESC').addOrderBy('t.monthlyPrice', 'ASC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['createdBy'] });
    if (!t) throw new NotFoundException('Tariff not found');
    return t;
  }

  async create(dto: Partial<SmmTariff>, createdById?: string) {
    const t = this.repo.create({ ...dto, createdById: dto.createdById ?? createdById });
    return this.repo.save(t);
  }

  async update(id: string, dto: Partial<SmmTariff>) {
    await this.findOne(id);
    // Не позволяем перезаписать поле createdById через update
    const { createdById, id: _ignore, createdAt, updatedAt, ...patch } = dto as any;
    await this.repo.update(id, patch);
    return this.findOne(id);
  }

  /** Soft-toggle: тариф нельзя удалить (на него могут ссылаться проекты), но можно деактивировать. */
  async toggleActive(id: string) {
    const t = await this.findOne(id);
    await this.repo.update(id, { isActive: !t.isActive });
    return this.findOne(id);
  }

  /** Дублирование: создаёт копию с пометкой " (копия)" в имени. */
  async clone(id: string, createdById?: string) {
    const src = await this.findOne(id);
    const copy = this.repo.create({
      name: `${src.name} (копия)`,
      description: src.description,
      monthlyPrice: src.monthlyPrice,
      storiesPerMonth: src.storiesPerMonth,
      reelsPerMonth: src.reelsPerMonth,
      postsPerMonth: src.postsPerMonth,
      designsPerMonth: src.designsPerMonth,
      adsIncluded: src.adsIncluded,
      shootingDaysPerMonth: src.shootingDaysPerMonth,
      reportsPerMonth: src.reportsPerMonth,
      revisionLimit: src.revisionLimit,
      durationDays: src.durationDays,
      isActive: true,
      createdById: createdById ?? src.createdById,
    });
    return this.repo.save(copy);
  }

  async remove(id: string) {
    const t = await this.findOne(id);
    await this.repo.remove(t);
    return { message: 'Tariff deleted' };
  }
}
