import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/** Личная заметка/задача сотрудника (вкладка «Заметки» сторисмейкера).
 *  СТРОГО приватна: все выборки и мутации скоупятся по userId владельца —
 *  чужие заметки не видит никто, включая руководителей. */
@Entity('personal_notes')
@Index(['userId', 'date'])
export class PersonalNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Владелец (users.id). Единственный, кто видит и меняет заметку. */
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  text: string;

  /** День, к которому относится задача (подсветка в календаре). NULL — без даты. */
  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
