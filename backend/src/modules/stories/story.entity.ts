import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

@Entity('story_logs')
export class StoryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  projectId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ default: 0 })
  storiesCount: number;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'employeeId' })
  employee: User;

  @ManyToOne(() => Project, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @CreateDateColumn()
  createdAt: Date;
}
