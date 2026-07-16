import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Справочники организатора съёмок: клиенты, модели, места.
 *  Отдельные лёгкие сущности — НЕ связаны с «Базой клиентов» (лиды продаж). */

@Entity('org_clients')
export class OrgClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Компания / бренд. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  company: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  instagram: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  telegram: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('org_models')
export class OrgModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Пол: female | male. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: 'female' | 'male' | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  instagram: string | null;

  /** Типаж / описание внешности (legacy — единое поле, разбито на age/appearance/experience). */
  @Column({ type: 'text', nullable: true })
  look: string | null;

  /** Возраст (может быть диапазоном: «25», «25-30»). */
  @Column({ type: 'varchar', length: 60, nullable: true })
  age: string | null;

  /** Внешность: рост, телосложение, цвет волос и т.п. */
  @Column({ type: 'text', nullable: true })
  appearance: string | null;

  /** Опыт: съёмки, показы, портфолио. */
  @Column({ type: 'text', nullable: true })
  experience: string | null;

  /** Фотография модели — filename в /uploads/models. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  photo: string | null;

  /** Знание языков: «русский, английский…». Заменило «Заметку» в форме. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  languages: string | null;

  /** Ставка за съёмку, сомони. */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  rate: number | null;

  /** Legacy: поле убрано из формы моделей (заменено на languages),
   *  колонка сохранена, чтобы не терять старые данные. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('org_places')
export class OrgPlace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  /** Контакт места (администратор, телефон). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  contact: string | null;

  /** Стоимость аренды/съёмки, сомони. */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  price: number | null;

  /** Ссылка: карта, инстаграм локации и т.п. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
