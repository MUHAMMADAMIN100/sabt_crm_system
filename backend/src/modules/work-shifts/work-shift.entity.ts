import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Рабочая смена сотрудника: нажал «Начать работу» — запись открылась,
 *  нажал «Завершить» — закрылась.
 *
 *  Отдельно от time_logs намеренно: там время пишется НА ЗАДАЧУ (taskId
 *  обязателен), а смена ни к какой задаче не привязана. Складывать их в одну
 *  таблицу — значит ломать и то, и другое.
 *
 *  Смен за день может быть несколько (ушёл на обед — закрыл, вернулся —
 *  открыл); в статистике они складываются. */
@Entity('work_shifts')
export class WorkShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: User;

  @Column()
  employeeId: string;

  @Column({ type: 'timestamp' })
  startedAt: Date;

  /** NULL — смена идёт прямо сейчас. */
  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;

  /** Смену закрыл не человек, а ночной крон: забыли нажать «Завершить».
   *  В статистике такие часы честно помечаем, чтобы им не доверяли вслепую. */
  @Column({ default: false })
  autoClosed: boolean;

  /** Чем закончился отрезок:
   *    pause — человек на паузе (обед, отлучился), день не закрыт;
   *    stop  — смена завершена;
   *    auto  — закрыл ночной крон, забыли нажать «Завершить».
   *  NULL — отрезок ещё идёт. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  endReason: 'pause' | 'stop' | 'auto' | null;

  /** Чем занят перерыв, который НАЧАЛСЯ после этого отрезка:
   *    lunch    — обед, идёт в оплачиваемые часы (до лимита);
   *    work     — выехал по работе: съёмка, встреча, банк — это работа;
   *    personal — личное, в часы не идёт.
   *  NULL — отрезок закончился не перерывом либо причина не указана. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  pauseKind: 'lunch' | 'work' | 'personal' | null;

  /** Последний раз, когда человек был в системе с открытой сменой. По нему
   *  ночной крон закрывает забытую смену — иначе в табель шло 23:59. */
  @Column({ type: 'timestamptz', nullable: true })
  lastPingAt: Date | null;

  /** Дата начала смены в календаре Душанбе (YYYY-MM-DD). Хранится отдельно,
   *  чтобы группировка по дням не зависела от часового пояса сервера. */
  @Index()
  @Column({ type: 'date' })
  date: string;

  @CreateDateColumn()
  createdAt: Date;
}
