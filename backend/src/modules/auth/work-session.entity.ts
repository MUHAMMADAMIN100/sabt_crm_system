import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('work_sessions')
export class WorkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'timestamptz' })
  loginAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  logoutAt: Date;

  /** Последний сигнал «жив» от вкладки пользователя. Используется чтобы
   *  закрыть «висящую» сессию реальным временем последней активности,
   *  а не моментом нового входа. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  durationHours: number;

  @Column({ type: 'date' })
  date: string;
}
