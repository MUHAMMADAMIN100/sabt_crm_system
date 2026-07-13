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

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  instagram: string | null;

  /** Типаж / описание внешности. */
  @Column({ type: 'text', nullable: true })
  look: string | null;

  /** Ставка за съёмку, сомони. */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  rate: number | null;

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
