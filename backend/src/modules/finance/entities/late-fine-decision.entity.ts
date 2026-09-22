import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Решение по одному опозданию: оштрафовали или простили.
 *
 *  Живёт в финансах, потому что штраф — деньги, и отменять его надо вместе с
 *  записью в журнале сотрудника. Один день — одно решение (уникальный ключ),
 *  поэтому список «опоздали сегодня» показывает только тех, по кому решения
 *  ещё нет. */
@Entity('late_fine_decisions')
@Index(['userId', 'date'], { unique: true })
export class LateFineDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Аккаунт CRM — опоздание живёт в сменах, а они привязаны к аккаунту. */
  @Column()
  userId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 10 })
  decision: 'fined' | 'forgiven';

  /** Строка ведомости и запись штрафа в ней — по ним делается отмена. */
  @Column({ type: 'uuid', nullable: true })
  employeeId: string | null;

  @Column({ type: 'uuid', nullable: true })
  entryId: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  /** Месяц начисления, в который лёг штраф. */
  @Column({ type: 'varchar', length: 7, nullable: true })
  ym: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
