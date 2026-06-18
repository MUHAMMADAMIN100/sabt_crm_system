import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** Съёмочная сессия — группирует несколько рилсов под одну съёмку
 *  (одна дата/место/время). Карточки ссылаются через shootSessionId.
 *  Позволяет «Подтвердить съёмку» пачкой для всей сессии. */
@Entity('shoot_sessions')
export class ShootSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'varchar', nullable: true })
  time: string | null;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
