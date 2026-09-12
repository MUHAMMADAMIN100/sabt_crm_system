import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** Съёмочная сессия — наследие удалённой «Доски проектов»: группировала
 *  несколько рилсов под одну съёмку (дата/место/время). Новые съёмки
 *  создаются как задачи подготовки в контент-плане (`shootForItemId`).
 *  Сущность сохранена, потому что старые сессии продолжают показываться
 *  в умном календаре (`smmCalendar`) и в общем календаре, и их можно
 *  переносить по датам — см. `updateShootSession` в ContentPlanService. */
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
