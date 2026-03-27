import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';

@Entity('file_attachments')
export class FileAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalName: string;

  @Column()
  filename: string;

  @Column()
  path: string;

  @Column()
  mimetype: string;

  @Column()
  size: number;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn()
  uploadedBy: User;

  @Column()
  uploadedById: string;

  @ManyToOne(() => Project, project => project.files, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn()
  project: Project;

  @Column({ nullable: true })
  projectId: string;

  @ManyToOne(() => Task, task => task.files, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn()
  task: Task;

  @Column({ nullable: true })
  taskId: string;

  @CreateDateColumn()
  createdAt: Date;
}
