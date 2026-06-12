import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmmTariff } from './smm-tariff.entity';

export interface ListFilters {
  search?: string;
  isActive?: boolean;
}

/** Канонические тарифы WeBrand из официальной таблицы услуг SMM
 *  (Start / Business / Premium) + пустой «Индивидуальный» для случаев
 *  когда менеджер сам задаёт лимиты и цену проекту. Сидятся в БД при
 *  старте сервиса — при изменении значений просто меняем константы. */
const CANON_TARIFFS: Array<Partial<SmmTariff>> = [
  {
    name: 'Start',
    description: 'Тариф Start — базовый пакет для одного канала.',
    monthlyPrice: 3499 as any,
    storiesPerMonth: 30,
    reelsPerMonth: 4,
    postsPerMonth: 3,
    designsPerMonth: 0,
    adsIncluded: false,
    shootingDaysPerMonth: 0,
    reportsPerMonth: 1,
    revisionLimit: 2,
    durationDays: 30,
    isActive: true,
    isCustom: false,
  },
  {
    name: 'Business',
    description: 'Тариф Business — расширенный пакет с настройкой таргета.',
    monthlyPrice: 5499 as any,
    storiesPerMonth: 50,
    reelsPerMonth: 7,
    postsPerMonth: 4,
    designsPerMonth: 0,
    adsIncluded: true,
    shootingDaysPerMonth: 0,
    reportsPerMonth: 2,
    revisionLimit: 3,
    durationDays: 30,
    isActive: true,
    isCustom: false,
  },
  {
    name: 'Premium',
    description: 'Тариф Premium — полный пакет с проект-менеджером и доп. площадками.',
    monthlyPrice: 7499 as any,
    storiesPerMonth: 70,
    reelsPerMonth: 10,
    postsPerMonth: 7,
    designsPerMonth: 0,
    adsIncluded: true,
    shootingDaysPerMonth: 0,
    reportsPerMonth: 4,
    revisionLimit: 5,
    durationDays: 30,
    isActive: true,
    isCustom: false,
  },
  {
    name: 'Индивидуальный',
    description: 'Параметры тарифа (лимиты и цена) задаёт менеджер вручную при назначении проекту.',
    monthlyPrice: 0 as any,
    storiesPerMonth: 0,
    reelsPerMonth: 0,
    postsPerMonth: 0,
    designsPerMonth: 0,
    adsIncluded: false,
    shootingDaysPerMonth: 0,
    reportsPerMonth: 0,
    revisionLimit: 0,
    durationDays: 30,
    isActive: true,
    isCustom: true,
  },
];

@Injectable()
export class SmmTariffsService implements OnModuleInit {
  private readonly logger = new Logger(SmmTariffsService.name);

  constructor(
    @InjectRepository(SmmTariff) private repo: Repository<SmmTariff>,
  ) {}

  /** Рантайм-миграция + сид канонических тарифов. */
  async onModuleInit() {
    // 1) ALTER TABLE ADD COLUMN IF NOT EXISTS isCustom — на случай если
    //    в БД ещё нет колонки (старая схема без поля).
    try {
      await this.repo.manager.query(
        `ALTER TABLE smm_tariffs ADD COLUMN IF NOT EXISTS "isCustom" boolean NOT NULL DEFAULT false`,
      );
    } catch (e: any) {
      this.logger.warn(`ALTER TABLE smm_tariffs isCustom failed: ${e?.message || e}`);
    }

    // 2) Сид/обновление канонических тарифов. Сравнение по имени
    //    (case-insensitive). Любые «индивид*» (Индивидуал, Индив.тариф)
    //    считаются дубликатами канонического «Индивидуальный» и
    //    деактивируются. Существующие проекты сохраняют их в snapshot —
    //    данные не теряются.
    try {
      const all = await this.repo.find();
      const canonNames = new Set(CANON_TARIFFS.map(t => (t.name || '').toLowerCase()));
      const isIndividualLike = (name: string) =>
        /^индивид/i.test((name || '').trim());
      for (const t of all) {
        const lower = String(t.name || '').toLowerCase();
        // Точно канонический — пропускаем (его обновит цикл ниже).
        if (canonNames.has(lower)) continue;
        // Не канонический. Деактивируем если был активен, ИЛИ если это
        // дубль «индивидуального» (даже если деактивирован — чтобы не
        // путать в админке).
        if (t.isActive || isIndividualLike(t.name)) {
          await this.repo.update(t.id, { isActive: false });
        }
      }
      for (const canon of CANON_TARIFFS) {
        const existing = all.find(
          t => String(t.name || '').toLowerCase() === String(canon.name || '').toLowerCase(),
        );
        if (existing) {
          // Обновляем лимиты/цену — но НЕ трогаем createdById/createdAt.
          await this.repo.update(existing.id, {
            description: canon.description,
            monthlyPrice: canon.monthlyPrice,
            storiesPerMonth: canon.storiesPerMonth,
            reelsPerMonth: canon.reelsPerMonth,
            postsPerMonth: canon.postsPerMonth,
            designsPerMonth: canon.designsPerMonth,
            adsIncluded: canon.adsIncluded,
            shootingDaysPerMonth: canon.shootingDaysPerMonth,
            reportsPerMonth: canon.reportsPerMonth,
            revisionLimit: canon.revisionLimit,
            durationDays: canon.durationDays,
            isActive: canon.isActive,
            isCustom: canon.isCustom,
          } as any);
        } else {
          await this.repo.save(this.repo.create(canon as any));
        }
      }
      this.logger.log('SMM tariffs seeded (Start/Business/Premium/Индивидуальный)');
    } catch (e: any) {
      this.logger.warn(`SMM tariffs seed failed: ${e?.message || e}`);
    }
  }

  /** Цены тарифа видят только founder/co_founder. Все остальные
   *  (admin, smm_director, video_director, sales_manager и т.д.)
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
