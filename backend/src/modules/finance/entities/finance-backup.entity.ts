import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Снимок всех финансовых данных (формат exportAll). */
@Entity('finance_backups')
export class FinanceBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'auto' })
  kind: 'auto' | 'manual' | 'pre_restore' | 'pre_import';

  /** Краткая сводка снимка для списка — без загрузки самого data. */
  @Column({ type: 'jsonb', nullable: true })
  stats: Record<string, number> | null;

  @Column({ type: 'jsonb' })
  data: any;

  @CreateDateColumn()
  createdAt: Date;
}
