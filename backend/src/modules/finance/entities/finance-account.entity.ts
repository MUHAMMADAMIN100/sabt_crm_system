import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Счёт компании (Alif, Dushanbe City, Наличные, …). Пользователь может
 *  добавлять свои счета. `key` — стабильный ключ для дефолтных счетов, по
 *  которому бэкфиллим старые транзакции с enum-полем `account`. */
@Entity('finance_accounts')
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Ключ дефолтного счёта: alif | dushanbe_city | cash. У пользовательских — null. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  key: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Стартовый баланс — сколько было на счёте на момент запуска учёта. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  startBalance: number;

  /** Цвет счёта (hex) для рендера на фронте. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  color: string | null;

  /** Вид счёта: bank | cash | savings. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  kind: string | null;

  /** Архивный счёт: скрыт из карточек и селектов, операции и история целы. */
  @Column({ type: 'boolean', default: false })
  archived: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
