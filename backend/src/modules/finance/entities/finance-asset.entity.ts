import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Единица инвентаря (оборудование склада): камера, свет, мебель и т.п.
 *  Амортизация линейная — цена равными долями за срок службы; остаточная
 *  стоимость считается на лету (см. FinanceService.decorateAsset). */
@Entity('finance_assets')
export class FinanceAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Категория: техника / свет / звук / мебель / реквизит / прочее. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  category: string | null;

  /** Дата приобретения (ISO). Точка отсчёта амортизации. */
  @Column({ type: 'date', nullable: true })
  purchaseDate: string | null;

  /** Цена покупки, сомони. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  price: number;

  /** Срок службы в месяцах (0 — не амортизируется, например реквизит). */
  @Column({ type: 'int', default: 0 })
  serviceMonths: number;

  /** in_use — в работе, repair — в ремонте, written_off — списано, sold — продано. */
  @Column({ type: 'varchar', length: 16, default: 'in_use' })
  status: 'in_use' | 'repair' | 'written_off' | 'sold';

  /** Кому выдано (ответственный) — свободный текст. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  assignee: string | null;

  /** Серийный номер / инвентарный код. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  serial: string | null;

  /** Гарантия до (ISO) — для напоминания о сроке. */
  @Column({ type: 'date', nullable: true })
  warrantyUntil: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
