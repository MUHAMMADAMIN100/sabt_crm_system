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

  /** Цены тарифа видят только founder/co_founder. Все остальные
   *  (admin, smm_director, head_smm, project_manager, sales_manager и т.д.)
   *  могут смотреть состав тарифа (stories/reels/posts/designs/...) и
   *  редактировать всё кроме цены, но саму цену не видят. */
  stripPrice<T extends SmmTariff | SmmTariff[]>(data: T, role?: string): T {
    const isFinance = role === 'founder' || role === 'co_founder';
    if (isFinance) return data;
    const strip = (t: any) => {
      if (!t) return t;
      delete t.monthlyPrice;
      return t;
    };
    return Array.isArray(data) ? (data.map(strip) as T) : (strip(data) as T);
  }

  async findAll(f: ListFilters = {}, role?: string) {
    const qb = this.repo.createQueryBuilder('t')
      .leftJoinAndSelect('t.createdBy', 'createdBy');
    if (f.search) {
      qb.andWhere('(t.name ILIKE :s OR t.description ILIKE :s)', { s: `%${f.search}%` });
    }
    if (typeof f.isActive === 'boolean') {
      qb.andWhere('t.isActive = :a', { a: f.isActive });
    }
    qb.orderBy('t.isActive', 'DESC').addOrderBy('t.monthlyPrice', 'ASC');
    const list = await qb.getMany();
    return this.stripPrice(list, role);
  }

  async findOne(id: string, role?: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['createdBy'] });
    if (!t) throw new NotFoundException('Tariff not found');
    return this.stripPrice(t, role);
  }

  /** Внутренний поиск без strip — нужен сервисам (clone/update/snapshot
   *  цены в проекте и т.п.). Не вызывать из контроллеров напрямую. */
  private async findOneInternal(id: string) {
    const t = await this.repo.findOne({ where: { id }, relations: ['createdBy'] });
    if (!t) throw new NotFoundException('Tariff not found');
    return t;
  }

  async create(dto: Partial<SmmTariff>, createdById?: string, role?: string) {
    // Цену задаёт только founder/co_founder. Для остальных ролей при
    // создании тариф будет с monthlyPrice = 0 — финансовый владелец
    // потом проставит цену в редактировании.
    const cleanDto = { ...dto } as any;
    if (role !== 'founder' && role !== 'co_founder') {
      cleanDto.monthlyPrice = 0;
    }
    const t = this.repo.create({ ...cleanDto, createdById: cleanDto.createdById ?? createdById });
    const saved = await this.repo.save(t);
    return this.stripPrice(saved, role);
  }

  async update(id: string, dto: Partial<SmmTariff>, role?: string) {
    await this.findOneInternal(id);
    // Не позволяем перезаписать поле createdById через update
    const { createdById, id: _ignore, createdAt, updatedAt, ...patch } = dto as any;
    // Цену могут менять ТОЛЬКО founder/co_founder. Остальным просто
    // удаляем поле из патча, не падая 403, чтобы UI без поля цены
    // мог сохранять остальные изменения.
    if (role !== 'founder' && role !== 'co_founder') {
      delete (patch as any).monthlyPrice;
    }
    await this.repo.update(id, patch);
    return this.findOne(id, role);
  }

  /** Soft-toggle: тариф нельзя удалить (на него могут ссылаться проекты), но можно деактивировать. */
  async toggleActive(id: string, role?: string) {
    const t = await this.findOneInternal(id);
    await this.repo.update(id, { isActive: !t.isActive });
    return this.findOne(id, role);
  }

  /** Дублирование: создаёт копию с пометкой " (копия)" в имени. */
  async clone(id: string, createdById?: string, role?: string) {
    const src = await this.findOneInternal(id);
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
    const saved = await this.repo.save(copy);
    return this.stripPrice(saved, role);
  }

  async remove(id: string) {
    const t = await this.findOneInternal(id);
    await this.repo.remove(t);
    return { message: 'Tariff deleted' };
  }
}
