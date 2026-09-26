import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Разрешённые группировки сохранённого представления доски (контракт D).
 *  Невалидное значение → 400 (проверяет сервис + DTO). */
export const DEV_BOARD_VIEW_GROUP_BY = ['status', 'priority', 'assignee'] as const;
export type DevBoardViewGroupBy = (typeof DEV_BOARD_VIEW_GROUP_BY)[number];

/** Сохранённое представление доски (saved view, контракт D).
 *  Фильтры бэк хранит непрозрачно (JSONB): их трактует фронт,
 *  бэк только сохраняет/отдаёт как есть. Удаление — владелец или
 *  dev-tracker.manage. Удаление пользователя сносит его вьюхи (CASCADE). */
@Entity('dev_board_view')
export class DevBoardView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  owner: User;

  @Column()
  ownerId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Непрозрачный для бэка набор фильтров фронта. default '{}'. */
  @Column({ type: 'jsonb', default: {} })
  filters: Record<string, any>;

  @Column({ type: 'varchar', length: 20, default: 'status' })
  groupBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
