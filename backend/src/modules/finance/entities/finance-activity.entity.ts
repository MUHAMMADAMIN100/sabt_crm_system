import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Журнал активности финансов: кто, что и когда изменил. Пишется
 *  интерцептором на каждый успешный мутирующий запрос к /finance/*. */
@Entity('finance_activity')
@Index(['createdAt'])
export class FinanceActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Кто сделал (users.id). Имя резолвится джойном при чтении. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** Человекочитаемое действие: «Добавил операцию», «Выплата ЗП»… */
  @Column({ type: 'varchar', length: 160 })
  action: string;

  /** HTTP-метод + маршрут — точная идентификация места. */
  @Column({ type: 'varchar', length: 200 })
  route: string;

  /** Параметры/тело запроса (усечённые) — «что именно» менялось. */
  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
