import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, OneToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum EmployeeStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fullName: string;

  @Column()
  position: string;

  @Column({ default: 'Общий' })
  department: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  telegram: string;

  @Column({ nullable: true })
  telegramChatId: string;

  @Column({ nullable: true })
  instagram: string;

  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  hireDate: Date;

  @Column({ type: 'enum', enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  status: EmployeeStatus;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true })
  bio: string;

  @Column({ nullable: true })
  salary: number;

  @Column({ default: false })
  isSubAdmin: boolean;

  @Column({ nullable: true })
  managerId: string;

  @Column({ default: 0 })
  tasksCompleted: number;

  @Column({ default: 0 })
  tasksOverdue: number;

  @Column({ default: 0 })
  tasksReturned: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  activityScore: number;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date;

  @OneToOne(() => User, { nullable: true, eager: false })
  @JoinColumn()
  user: User;

  @Column({ nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
