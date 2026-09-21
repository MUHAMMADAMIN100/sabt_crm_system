import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** День без смены по уважительной причине.
 *
 *  Пустой день в табеле сам по себе ничего не значит: это может быть отгул,
 *  отпуск, больничный — или человек просто забыл нажать «Начать». Отметку
 *  ставит руководство, и тогда день перестаёт выглядеть прогулом. */
@Entity('shift_absences')
@Index(['employeeId', 'date'], { unique: true })
export class ShiftAbsence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 12 })
  kind: 'dayoff' | 'vacation' | 'sick' | 'holiday';

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
