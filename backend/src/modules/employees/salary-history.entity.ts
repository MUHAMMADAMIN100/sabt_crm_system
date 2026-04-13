import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { Employee } from './employee.entity';
import { User } from '../users/user.entity';

@Entity('salary_history')
export class SalaryHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @Column()
  employeeId: string;

  /** Monthly salary that becomes effective starting from `effectiveFrom`. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  salary: number;

  @Column({ type: 'date' })
  effectiveFrom: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changedById' })
  changedBy: User;

  @Column({ nullable: true })
  changedById: string;

  @CreateDateColumn()
  createdAt: Date;
}
