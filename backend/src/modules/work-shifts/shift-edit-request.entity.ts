import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Просьба поправить время смены: «забыл нажать в 9:00, нажал в 11:04».
 *
 *  Сотрудник не правит табель сам — иначе учёт времени теряет смысл. Он
 *  просит, руководитель подтверждает; до подтверждения в табеле остаётся
 *  то время, которое записала система. */
@Entity('shift_edit_requests')
export class ShiftEditRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  employeeId: string;

  /** День смены в календаре Душанбе. */
  @Column({ type: 'date' })
  date: string;

  /** Что правим: начало или конец смены. */
  @Column({ type: 'varchar', length: 8 })
  field: 'start' | 'end';

  /** Время, которое просит поставить сотрудник, 'HH:MM'. */
  @Column({ type: 'varchar', length: 5 })
  requestedTime: string;

  /** Что стоит сейчас — чтобы руководитель видел разницу, не считая сам. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  currentTime: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'approved' | 'rejected';

  /** Отрезок, к которому относится правка (первый или последний за день). */
  @Column({ type: 'uuid', nullable: true })
  shiftId: string | null;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
