import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * Кастинг WeBrand (17.11.2026, docs/CASTING_SPEC.md §1): люди для съёмок,
 * их фото, участие в съёмках и заявки клиентов с публичного каталога.
 * Таблицы создаёт миграция 1837000000000-Casting (и дублирует
 * CastingService.onModuleInit). Связи — простые uuid, как в «Компасе»:
 * внешние ключи живут в миграции.
 */

/** Человек из базы кастинга. */
@Entity('casting_talents')
@Unique('UQ_casting_talents_source_key', ['sourceKey'])
export class CastingTalent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** actor | blogger | model */
  @Column({ type: 'text', array: true, default: '{}' })
  categories: string[];

  @Column({ type: 'varchar', length: 200, nullable: true })
  city: string | null;

  /** Свободный текст: «175», «180+», «154-155». */
  @Column({ type: 'varchar', length: 20, nullable: true })
  height: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate: string | null;

  /** Возраст на дату ageBaseAt (из импорта или формы, если нет даты рождения). */
  @Column({ type: 'int', nullable: true })
  ageBase: number | null;

  @Column({ type: 'date', nullable: true })
  ageBaseAt: string | null;

  /** ads | film | theatre | clips | social | model */
  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  experience: string | null;

  /** Только http(s). */
  @Column({ type: 'text', array: true, default: '{}' })
  links: string[];

  /** Внутреннее — в публичный каталог не уходит. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  /** Внутреннее. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  telegram: string | null;

  /** Гонорар текстом. Внутреннее. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  rate: string | null;

  /** Внутреннее. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Показывать в каталоге для клиентов. */
  @Column({ type: 'boolean', default: true })
  isPublic: boolean;

  @Column({ type: 'boolean', default: false })
  isArchived: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** «webrand-casting:<id>» — повторный импорт не дублирует. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  sourceKey: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Фото человека: файл в ./uploads/casting под случайным именем. */
@Entity('casting_photos')
@Index('IDX_casting_photos_talent', ['talentId', 'sortOrder'])
export class CastingPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  talentId: string;

  /** «/uploads/casting/<uuid>.jpg» */
  @Column({ type: 'varchar', length: 300 })
  path: string;

  /** Имя файла из импорта (t00_0.jpg) — чтобы повторный импорт не дублировал фото. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceName: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Человек в съёмке: contentItemId — карточка съёмки (ShootRow.id у продюсера). */
@Entity('casting_bookings')
@Unique('UQ_casting_bookings_talent_item', ['talentId', 'contentItemId'])
@Index('IDX_casting_bookings_item', ['contentItemId'])
export class CastingBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  talentId: string;

  @Column({ type: 'uuid' })
  contentItemId: string;

  /** invited | confirmed | declined */
  @Column({ type: 'varchar', length: 16, default: 'invited' })
  status: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Заявка клиента с публичного каталога: по строке на человека. */
@Entity('casting_requests')
@Index('IDX_casting_requests_talent', ['talentId'])
export class CastingRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  talentId: string;

  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
