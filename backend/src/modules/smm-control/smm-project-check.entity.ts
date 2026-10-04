import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Отметки раздела «СММ → Контроль» по проекту за месяц (решение владельца
 * 03.10.2026, вариант А): доволен ли клиент, были ли на связи, отправлен ли
 * отчёт. Остальные столбцы раздела (свежесть аккаунта, рилсы, посты, сторис,
 * оплата) считаются из контент-плана, сторис и Финансов — здесь только то,
 * что знает человек.
 */
// Одна строка на проект и месяц — уникальный индекс в миграции 1812000000000.
@Entity('smm_project_checks')
export class SmmProjectCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  /** Месяц 'YYYY-MM'. */
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  /** Как клиент: good — доволен, meh — так себе, bad — недоволен; null — отзыва не было. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  mood: 'good' | 'meh' | 'bad' | null;

  /** Что сказал клиент, своими словами. */
  @Column({ type: 'text', nullable: true })
  moodNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  moodAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  moodById: string | null;

  /** На связи: в этом месяце был созвон или встреча с клиентом. */
  @Column({ type: 'boolean', default: false })
  contact: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  contactAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  contactById: string | null;

  /** Отчёт за месяц клиенту отправлен. */
  @Column({ type: 'boolean', default: false })
  report: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  reportAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reportById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
