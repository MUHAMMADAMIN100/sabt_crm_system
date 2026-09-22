import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** «Приду позже» — просьба, поданная ЗАРАНЕЕ.
 *
 *  Одобренная просьба снимает опоздание за этот день: иначе предупреждать
 *  не имело бы смысла. Поданная в тот же день доходит до руководителя, но
 *  от штрафа не спасает — об этом честно написано в форме. */
@Entity('late_notices')
@Index(['userId', 'date'])
export class LateNotice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'date' })
  date: string;

  /** Во сколько человек обещает прийти. */
  @Column({ type: 'varchar', length: 5 })
  plannedTime: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'approved' | 'rejected';

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
